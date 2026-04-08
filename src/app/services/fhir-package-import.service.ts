// Author: Preston Lee

import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { Bundle, OperationOutcome, Resource } from 'fhir/r4';
import { FhirPackageImportItemOutcome } from '../models/fhir-package-import.types';
import { IndexedResourceRowVm } from '../models/fhir-package-view.model';
import { resolvePackageArchiveKey } from './fhir-package-archive-path.lib';
import { TerminologyService } from './terminology.service';
import { FhirClientService } from './fhir-client.service';
import { SettingsService } from './settings.service';

const TERM_ORDER: Record<string, number> = {
  CodeSystem: 0,
  NamingSystem: 1,
  ValueSet: 2,
  ConceptMap: 3
};

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
    return { termRes: this.sortTermResources(termRes), dataRes };
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
      await this.postResourcesOneByOne(
        combined,
        (bundle) => this.terminologyService.postBundle(bundle),
        'Merged import',
        outcomes,
        onProgress
      );
    } else {
      if (termRes.length > 0) {
        await this.postResourcesOneByOne(
          termRes,
          (bundle) => this.terminologyService.postBundle(bundle),
          'Terminology',
          outcomes,
          onProgress
        );
      }
      if (dataRes.length > 0) {
        await this.postResourcesOneByOne(
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
      const ida = (a as { id?: string }).id ?? '';
      const idb = (b as { id?: string }).id ?? '';
      return ida.localeCompare(idb);
    });
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

  private formatResourceProgressLabel(f: {
    resourceType: string;
    resourceId: string;
    filename: string;
  }): string {
    const tail = f.filename !== '—' ? ` — ${f.filename}` : '';
    return `${f.resourceType}/${f.resourceId}${tail}`;
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

  /**
   * One resource per request so failures name a single artifact (type, id, package path).
   * Large imports are slower than batched bundles but easier to retry selectively.
   */
  private async postResourcesOneByOne(
    resources: Resource[],
    post: (b: Bundle<Resource>) => Observable<Bundle<Resource>>,
    channelLabel: string,
    outcomes: FhirPackageImportItemOutcome[],
    onProgress: (message: string) => void
  ): Promise<void> {
    const total = resources.length;
    for (let i = 0; i < resources.length; i++) {
      const resource = resources[i];
      const fields = this.resourceImportFields(resource);
      const bundle: Bundle<Resource> = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [{ resource }]
      };
      onProgress(
        `${channelLabel}: ${i + 1}/${total} ${this.formatResourceProgressLabel(fields)}`
      );
      try {
        const response = await firstValueFrom(post(bundle));
        const ent = response.entry?.[0];
        const status = this.bundleEntryStatusString(ent?.response?.status);
        if (status !== '' && !/^2/.test(status)) {
          const oc = ent?.response?.outcome as OperationOutcome | undefined;
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
      } catch (e) {
        outcomes.push({
          channel: channelLabel,
          ...fields,
          ok: false,
          message: this.describeFailure(e)
        });
      }
    }
  }
}
