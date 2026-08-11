// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { Bundle, Resource } from 'fhir/r4';
import { FhirClientService } from './fhir-client.service';
import { TerminologyService } from './terminology.service';
import { SettingsService } from './settings.service';
import { resourceTypeOf } from './fhir-resource-type.lib';
import { collectionBundleToTransaction } from './fhir-bundle-transaction.lib';
import {
  cloneBundleEntriesWithHapiSafeClientIds,
  cloneResourcesWithHapiSafeClientIds
} from './fhir-hapi-client-id.lib';
import { describeFhirHttpFailure } from './fhir-http-error.lib';

const TERMINOLOGY_TYPES = new Set(['CodeSystem', 'ValueSet', 'ConceptMap', 'NamingSystem']);

const TERM_ORDER: Record<string, number> = {
  CodeSystem: 1,
  NamingSystem: 2,
  ValueSet: 3,
  ConceptMap: 4
};

export interface ExportPublishOutcome {
  channel: 'terminology' | 'data' | 'merged';
  success: boolean;
  message: string;
  response?: Bundle;
}

@Injectable({
  providedIn: 'root'
})
export class ExportPublishService {
  private readonly fhirClient = inject(FhirClientService);
  private readonly terminologyService = inject(TerminologyService);
  private readonly settingsService = inject(SettingsService);

  partitionResources(resources: Resource[]): { termRes: Resource[]; dataRes: Resource[] } {
    const termRes: Resource[] = [];
    const dataRes: Resource[] = [];
    for (const r of resources) {
      const rt = resourceTypeOf(r) ?? '';
      if (TERMINOLOGY_TYPES.has(rt)) {
        termRes.push(r);
      } else {
        dataRes.push(r);
      }
    }
    return {
      termRes: this.sortTerm(termRes),
      dataRes
    };
  }

  /**
   * Publish a pre-built Bundle (e.g. CRMI transaction with ifNoneExist).
   * Entries that already have `request` are preserved; collection bundles with
   * requests are promoted to transaction before POST.
   */
  async publishBundle(
    bundle: Bundle,
    onProgress?: (message: string) => void
  ): Promise<ExportPublishOutcome[]> {
    const resources = (bundle.entry ?? [])
      .map((e) => e.resource)
      .filter((r): r is Resource => !!r);

    const hasRequests = (bundle.entry ?? []).some((e) => !!e.request);
    if (hasRequests) {
      const transactionBundle: Bundle =
        bundle.type === 'transaction'
          ? bundle
          : {
              ...bundle,
              type: 'transaction'
            };
      return this.publishPartitionedBundles(resources, transactionBundle, onProgress);
    }

    return this.publishResources(resources, onProgress);
  }

  /**
   * Publish a flat resource list via unconditional PUT/POST transactions. For conditional-create
   * (CRMI) semantics, build a Bundle with `request` entries and call `publishBundle` instead.
   */
  async publishResources(
    resources: Resource[],
    onProgress?: (message: string) => void
  ): Promise<ExportPublishOutcome[]> {
    const { termRes, dataRes } = this.partitionResources(resources);
    const outcomes: ExportPublishOutcome[] = [];
    const tu = this.settingsService.getEffectiveTerminologyEndpointAddress().replace(/\/+$/, '');
    const fu = this.settingsService.getEffectiveDataEndpointAddress().replace(/\/+$/, '');
    const merged = termRes.length > 0 && dataRes.length > 0 && tu === fu;

    if (merged) {
      onProgress?.(`Publishing ${termRes.length + dataRes.length} resources (merged endpoint)…`);
      const bundle = this.toUnconditionalTransaction([...termRes, ...dataRes]);
      outcomes.push(await this.postChannel(bundle, 'merged', (b) => this.terminologyService.postBundle(b)));
      return outcomes;
    }

    if (termRes.length > 0) {
      onProgress?.(`Publishing ${termRes.length} terminology resources…`);
      const bundle = this.toUnconditionalTransaction(termRes);
      outcomes.push(
        await this.postChannel(bundle, 'terminology', (b) => this.terminologyService.postBundle(b))
      );
    }
    if (dataRes.length > 0) {
      onProgress?.(`Publishing ${dataRes.length} data resources…`);
      const bundle = this.toUnconditionalTransaction(dataRes);
      outcomes.push(await this.postChannel(bundle, 'data', (b) => this.fhirClient.postBundle(b)));
    }

    if (outcomes.length === 0) {
      outcomes.push({
        channel: 'data',
        success: false,
        message: 'No resources to publish.'
      });
    }
    return outcomes;
  }

  private async publishPartitionedBundles(
    resources: Resource[],
    fullBundle: Bundle,
    onProgress?: (message: string) => void
  ): Promise<ExportPublishOutcome[]> {
    const { termRes, dataRes } = this.partitionResources(resources);
    const entryByKey = new Map<string, NonNullable<Bundle['entry']>[number]>();
    for (const e of fullBundle.entry ?? []) {
      if (e.resource) {
        entryByKey.set(this.resourceKey(e.resource), e);
      }
    }

    const pickEntries = (list: Resource[]) =>
      list
        .map((r) => entryByKey.get(this.resourceKey(r)))
        .filter((e): e is NonNullable<Bundle['entry']>[number] => !!e);

    const outcomes: ExportPublishOutcome[] = [];
    const tu = this.settingsService.getEffectiveTerminologyEndpointAddress().replace(/\/+$/, '');
    const fu = this.settingsService.getEffectiveDataEndpointAddress().replace(/\/+$/, '');
    const merged = termRes.length > 0 && dataRes.length > 0 && tu === fu;

    if (merged) {
      onProgress?.('Publishing CRMI transaction (merged endpoint)…');
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'transaction',
        entry: cloneBundleEntriesWithHapiSafeClientIds(pickEntries([...termRes, ...dataRes]))
      };
      outcomes.push(await this.postChannel(bundle, 'merged', (b) => this.terminologyService.postBundle(b)));
      return outcomes;
    }

    if (termRes.length > 0) {
      onProgress?.('Publishing terminology CRMI transaction…');
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'transaction',
        entry: cloneBundleEntriesWithHapiSafeClientIds(pickEntries(termRes))
      };
      outcomes.push(
        await this.postChannel(bundle, 'terminology', (b) => this.terminologyService.postBundle(b))
      );
    }
    if (dataRes.length > 0) {
      onProgress?.('Publishing data CRMI transaction…');
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'transaction',
        entry: cloneBundleEntriesWithHapiSafeClientIds(pickEntries(dataRes))
      };
      outcomes.push(await this.postChannel(bundle, 'data', (b) => this.fhirClient.postBundle(b)));
    }
    return outcomes;
  }

  private toUnconditionalTransaction(resources: Resource[]): Bundle {
    // HAPI (HAPI-0960) rejects client-assigned logical ids made only of digits (common in
    // registry packages such as hl7.fhir.r4.core); rewrite them before building PUT entries.
    const safe = cloneResourcesWithHapiSafeClientIds(resources);
    return collectionBundleToTransaction({
      resourceType: 'Bundle',
      type: 'collection',
      entry: safe.map((resource) => ({ resource }))
    });
  }

  private async postChannel(
    bundle: Bundle,
    channel: ExportPublishOutcome['channel'],
    poster: (b: Bundle) => Observable<Bundle>
  ): Promise<ExportPublishOutcome> {
    try {
      const response = await firstValueFrom(poster(bundle));
      return {
        channel,
        success: true,
        message: `Published ${bundle.entry?.length ?? 0} resources via ${channel}.`,
        response
      };
    } catch (err) {
      return {
        channel,
        success: false,
        message: `Publish failed (${channel}): ${describeFhirHttpFailure(err)}`
      };
    }
  }

  private sortTerm(list: Resource[]): Resource[] {
    return [...list].sort((a, b) => {
      const oa = TERM_ORDER[resourceTypeOf(a) ?? ''] ?? 99;
      const ob = TERM_ORDER[resourceTypeOf(b) ?? ''] ?? 99;
      return oa - ob;
    });
  }

  private resourceKey(resource: Resource): string {
    const rt = resourceTypeOf(resource) ?? 'Resource';
    const meta = resource as unknown as { url?: string; id?: string };
    const id = typeof meta.id === 'string' ? meta.id : '';
    const url = typeof meta.url === 'string' ? meta.url : '';
    return `${rt}|${id}|${url}`;
  }
}
