// Author: Preston Lee

/**
 * Registry package import sends one FHIR R4 `transaction` Bundle per server channel (terminology URL,
 * data URL, or merged when both use the same base). Each entry is `PUT {type}/{id}` when the resource
 * has a logical id, otherwise `POST {type}` (see `collectionBundleToTransaction`). Purely numeric
 * logical ids are rewritten before send so HAPI-style servers accept client-assigned ids (HAPI-0960).
 * FHIR R4 processes
 * all POSTs before all PUTs in a transaction; resources that reference others in the same bundle may
 * need ids/`fullUrl` patterns per server behavior (https://www.hl7.org/fhir/R4/http.html#transaction).
 * SearchParameter resources that list only abstract `base` types (e.g. DomainResource) are skipped because
 * HAPI validates those codes and throws HAPI-1684 (see hl7.fhir.r4.core SearchParameter-DomainResource-text.json).
 */

import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { Bundle, OperationOutcome, Resource, SearchParameter } from 'fhir/r4';
import { FhirPackageImportItemOutcome } from '../models/fhir-package-import.types';
import { IndexedResourceRowVm } from '../models/fhir-package-view.model';
import { resolvePackageArchiveKey } from './fhir-package-archive-path.lib';
import { collectionBundleToTransaction } from './fhir-bundle-transaction.lib';
import { cloneResourcesWithHapiSafeClientIds } from './fhir-hapi-client-id.lib';
import { TerminologyService } from './terminology.service';
import { FhirClientService } from './fhir-client.service';
import { SettingsService } from './settings.service';

const TERM_ORDER: Record<string, number> = {
  CodeSystem: 0,
  NamingSystem: 1,
  ValueSet: 2,
  ConceptMap: 3
};

/** Bundle types that are envelopes or search results, not persisted as `Bundle` instances (HAPI-0522). */
const BUNDLE_TYPES_NOT_FOR_INSTANCE_STORAGE = new Set<string>([
  'searchset',
  'history',
  'batch',
  'batch-response',
  'transaction',
  'transaction-response'
]);

/**
 * Abstract base types in FHIR R4 — not valid `resourceType` for persisted instances (HAPI-1684 / HAPI-2223).
 * Some IGs (e.g. hl7.fhir.r4.core) ship example JSON using these names; servers reject `PUT DomainResource/…`.
 */
const R4_ABSTRACT_RESOURCE_TYPES = new Set<string>(['Resource', 'DomainResource']);

function compareResourceId(a: Resource, b: Resource): number {
  const ida = (a as { id?: string }).id ?? '';
  const idb = (b as { id?: string }).id ?? '';
  return ida.localeCompare(idb);
}

@Injectable({
  providedIn: 'root'
})
export class FhirPackageImportService {
  private readonly terminologyService = inject(TerminologyService);
  private readonly fhirClientService = inject(FhirClientService);
  private readonly settingsService = inject(SettingsService);

  collectResourcesFromFiles(
    selectedRows: IndexedResourceRowVm[],
    files: Map<string, Uint8Array>
  ): { resources: Resource[]; errors: string[] } {
    const resources: Resource[] = [];
    const errors: string[] = [];

    for (const row of selectedRows) {
      const key = resolvePackageArchiveKey(row.filename, files) ?? row.filename;
      const raw = files.get(key);
      if (!raw) {
        errors.push(`Missing file in archive: ${row.filename}`);
        continue;
      }
      try {
        const text = new TextDecoder('utf-8', { fatal: false }).decode(raw);
        const obj = JSON.parse(text) as Resource & { resourceType?: string; __filename?: string };
        if (!obj.resourceType) {
          errors.push(`Not a FHIR resource: ${row.filename}`);
          continue;
        }
        obj.__filename = row.filename;
        resources.push(obj as Resource);
      } catch (e) {
        errors.push(`${row.filename}: ${e instanceof Error ? e.message : 'parse error'}`);
      }
    }

    return { resources, errors };
  }

  partitionByTargets(
    resources: Resource[],
    selectedByPath: Map<string, IndexedResourceRowVm>
  ): { termRes: Resource[]; dataRes: Resource[] } {
    const termRes: Resource[] = [];
    const dataRes: Resource[] = [];
    for (const r of resources) {
      const key = (r as unknown as { __filename?: string }).__filename ?? '';
      const row = selectedByPath.get(key);
      if (!row) {
        continue;
      }
      if (row.targetTerminology) {
        termRes.push(r);
      }
      if (row.targetData) {
        dataRes.push(r);
      }
    }
    return { termRes: this.sortTermResources(termRes), dataRes: this.sortDataResources(dataRes) };
  }

  async importTerminologyAndData(
    termRes: Resource[],
    dataRes: Resource[],
    onProgress: (message: string) => void
  ): Promise<FhirPackageImportItemOutcome[]> {
    const outcomes: FhirPackageImportItemOutcome[] = [];
    const tu = this.settingsService.getEffectiveTerminologyBaseUrl().replace(/\/+$/, '');
    const fu = this.settingsService.getEffectiveFhirBaseUrl().replace(/\/+$/, '');
    const merged = termRes.length > 0 && dataRes.length > 0 && tu === fu;

    if (merged) {
      const combined = [...termRes, ...dataRes];
      await this.postRegistryTransactionForChannel(
        combined,
        (bundle) => this.terminologyService.postBundle(bundle),
        'Merged import',
        outcomes,
        onProgress
      );
    } else {
      if (termRes.length > 0) {
        await this.postRegistryTransactionForChannel(
          termRes,
          (bundle) => this.terminologyService.postBundle(bundle),
          'Terminology',
          outcomes,
          onProgress
        );
      }
      if (dataRes.length > 0) {
        await this.postRegistryTransactionForChannel(
          dataRes,
          (bundle) => this.fhirClientService.postBundle(bundle),
          'FHIR data',
          outcomes,
          onProgress
        );
      }
    }

    return outcomes;
  }

  private sortTermResources(list: Resource[]): Resource[] {
    return [...list].sort((a, b) => {
      const oa = TERM_ORDER[a.resourceType] ?? 99;
      const ob = TERM_ORDER[b.resourceType] ?? 99;
      if (oa !== ob) {
        return oa - ob;
      }
      return compareResourceId(a, b);
    });
  }

  private sortDataResources(list: Resource[]): Resource[] {
    return [...list].sort((a, b) => {
      const ta = a.resourceType;
      const tb = b.resourceType;
      if (ta !== tb) {
        return ta.localeCompare(tb);
      }
      return compareResourceId(a, b);
    });
  }

  /**
   * `collection` → `transaction`: `PUT` when `id` is set, else `POST {type}`.
   */
  private buildRegistryTransactionBundle(resources: Resource[]): Bundle<Resource> {
    const safe = cloneResourcesWithHapiSafeClientIds(resources);
    return collectionBundleToTransaction({
      resourceType: 'Bundle',
      type: 'collection',
      entry: safe.map((resource) => ({ resource }))
    });
  }

  private nonStorableAbstractResourceTypeMessage(resource: Resource): string | null {
    const rt = resource.resourceType;
    if (!R4_ABSTRACT_RESOURCE_TYPES.has(rt)) {
      return null;
    }
    return `Skipped — "${rt}" is an abstract FHIR R4 type, not a storable resource (not sent to the server).`;
  }

  private nonStorableImportedBundleMessage(resource: Resource): string | null {
    if (resource.resourceType !== 'Bundle') {
      return null;
    }
    const t = (resource as Bundle<Resource>).type;
    if (typeof t !== 'string' || !BUNDLE_TYPES_NOT_FOR_INSTANCE_STORAGE.has(t)) {
      return null;
    }
    return `Skipped — Bundle.type "${t}" is not stored as a server resource (not sent to the server).`;
  }

  /**
   * SearchParameter.base may list abstract types (Resource, DomainResource). HAPI resolves each code via
   * FhirContext.getResourceDefinition and fails with HAPI-1684 for abstract names even when the root
   * resource type is SearchParameter.
   */
  private nonStorableSearchParameterAbstractBaseMessage(resource: Resource): string | null {
    if (resource.resourceType !== 'SearchParameter') {
      return null;
    }
    const bases = (resource as SearchParameter).base;
    if (!Array.isArray(bases) || bases.length === 0) {
      return null;
    }
    const abstractBases = bases.filter(
      (b): b is string => typeof b === 'string' && R4_ABSTRACT_RESOURCE_TYPES.has(b)
    );
    if (abstractBases.length === 0) {
      return null;
    }
    const uniq = [...new Set(abstractBases)];
    return `Skipped — SearchParameter.base includes abstract type(s) (${uniq.join(', ')}) that HAPI cannot persist (HAPI-1684); not sent.`;
  }

  /**
   * One atomic transaction per channel; HTTP errors apply to every row.
   */
  private async postRegistryTransactionForChannel(
    resources: Resource[],
    post: (b: Bundle<Resource>) => Observable<Bundle<Resource>>,
    channelLabel: string,
    outcomes: FhirPackageImportItemOutcome[],
    onProgress: (message: string) => void
  ): Promise<void> {
    if (resources.length === 0) {
      return;
    }

    const allowed: Resource[] = [];
    for (const resource of resources) {
      const abstractSkip = this.nonStorableAbstractResourceTypeMessage(resource);
      if (abstractSkip) {
        const fields = this.resourceImportFields(resource);
        outcomes.push({
          channel: channelLabel,
          ...fields,
          ok: true,
          message: abstractSkip
        });
        continue;
      }
      const spAbstractSkip = this.nonStorableSearchParameterAbstractBaseMessage(resource);
      if (spAbstractSkip) {
        const fields = this.resourceImportFields(resource);
        outcomes.push({
          channel: channelLabel,
          ...fields,
          ok: true,
          message: spAbstractSkip
        });
        continue;
      }
      const bundleSkip = this.nonStorableImportedBundleMessage(resource);
      if (bundleSkip) {
        const fields = this.resourceImportFields(resource);
        outcomes.push({
          channel: channelLabel,
          ...fields,
          ok: true,
          message: bundleSkip
        });
        continue;
      }
      allowed.push(resource);
    }
    if (allowed.length === 0) {
      return;
    }

    const bundle = this.buildRegistryTransactionBundle(allowed);
    onProgress(`${channelLabel}: posting ${allowed.length} resources in one transaction`);
    try {
      const response = await firstValueFrom(post(bundle));
      const responseEntries = response.entry ?? [];
      for (let i = 0; i < allowed.length; i++) {
        const resource = allowed[i];
        const fields = this.resourceImportFields(resource);
        const ent = responseEntries[i];
        if (ent == null) {
          outcomes.push({
            channel: channelLabel,
            ...fields,
            ok: false,
            message: 'Missing transaction-response entry for this resource'
          });
          continue;
        }
        const status = this.bundleEntryStatusString(ent.response?.status);
        if (status !== '' && !/^2/.test(status)) {
          const oc = ent.response?.outcome as OperationOutcome | undefined;
          outcomes.push({
            channel: channelLabel,
            ...fields,
            ok: false,
            message: `${status}${this.outcomeSummary(oc)}`.trim()
          });
        } else {
          outcomes.push({
            channel: channelLabel,
            ...fields,
            ok: true,
            message: status || 'OK'
          });
        }
      }
    } catch (e) {
      const msg = this.describeFailure(e);
      for (const resource of allowed) {
        const fields = this.resourceImportFields(resource);
        outcomes.push({
          channel: channelLabel,
          ...fields,
          ok: false,
          message: msg
        });
      }
    }
  }

  private resourceImportFields(resource: Resource): {
    resourceType: string;
    resourceId: string;
    filename: string;
  } {
    const fn = (resource as { __filename?: string }).__filename?.trim() ?? '';
    const id = typeof (resource as { id?: string }).id === 'string' ? (resource as { id: string }).id.trim() : '';
    return {
      resourceType: resource.resourceType,
      resourceId: id || '—',
      filename: fn || '—'
    };
  }

  private outcomeSummary(outcome: OperationOutcome | undefined): string {
    const issues = outcome?.issue;
    if (!issues?.length) {
      return '';
    }
    const parts = issues
      .map((i) => {
        const d = i.diagnostics;
        const t = i.details?.text;
        const a = typeof d === 'string' ? d : d != null ? JSON.stringify(d) : '';
        const b = typeof t === 'string' ? t : t != null ? JSON.stringify(t) : '';
        return a || b;
      })
      .filter(Boolean);
    return parts.length ? ` — ${parts.join('; ')}` : '';
  }

  /** FHIR says `response.status` is a string; some stacks send numbers or omit it. */
  private bundleEntryStatusString(raw: unknown): string {
    if (raw == null) {
      return '';
    }
    if (typeof raw === 'string') {
      return raw.trim();
    }
    if (typeof raw === 'number') {
      return String(raw);
    }
    return '';
  }

  private describeFailure(e: unknown): string {
    if (e instanceof HttpErrorResponse) {
      const errBody = e.error;
      if (errBody != null && typeof errBody === 'object' && 'issue' in errBody) {
        const msg = this.outcomeSummary(errBody as OperationOutcome).replace(/^\s*—\s*/, '');
        return [e.message, msg].filter(Boolean).join(' — ');
      }
      if (typeof errBody === 'string' && errBody.trim()) {
        return `${e.message} — ${errBody.trim().slice(0, 500)}`;
      }
      return e.message || `${e.status ?? ''} ${e.statusText ?? ''}`.trim();
    }
    if (e instanceof Error) {
      return e.message;
    }
    if (typeof e === 'string') {
      return e;
    }
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
}
