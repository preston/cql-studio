// Author: Preston Lee

import { Injectable } from '@angular/core';
import {
  FhirPackageIndexFile,
  FhirPackageIndexJson,
  FhirPackageJson
} from '../models/fhir-package-registry.types';
import {
  IndexedResourceRowVm,
  PackageSummaryVm,
  SuggestedImportTarget
} from '../models/fhir-package-view.model';
import { resolvePackageArchiveKey } from './fhir-package-archive-path.lib';

const TERMINOLOGY_TYPES = new Set(['CodeSystem', 'ValueSet', 'ConceptMap', 'NamingSystem']);

@Injectable({
  providedIn: 'root'
})
export class FhirPackageMetadataService {
  buildPackageSummary(pkg: FhirPackageJson): PackageSummaryVm {
    const name = pkg.name ?? '';
    const version = pkg.version ?? '';
    const fhirVersions = [...(pkg.fhirVersions ?? pkg['fhir-version-list'] ?? [])].filter(Boolean);
    const deps = pkg.dependencies ?? {};
    const dependencyList = Object.entries(deps).map(([n, v]) => ({ name: n, version: String(v) }));
    const canonical = pkg.canonical ?? '';
    let canonicalHref = '';
    if (canonical && /^https?:\/\//i.test(canonical)) {
      canonicalHref = canonical;
    }

    return {
      name,
      version,
      packageType: pkg.type ?? '',
      title: pkg.title ?? name,
      description: pkg.description ?? '',
      canonical,
      canonicalHref,
      fhirVersions,
      dependencies: dependencyList,
      jurisdiction: pkg.jurisdiction ?? '',
      specUrl: pkg.url ?? '',
      license: pkg.license != null ? String(pkg.license) : '',
      author: pkg.author != null ? String(pkg.author) : '',
      date: pkg.date ?? ''
    };
  }

  buildIndexedRows(
    index: FhirPackageIndexJson | null,
    filesInArchive: Map<string, Uint8Array>
  ): IndexedResourceRowVm[] {
    const rows: IndexedResourceRowVm[] = [];
    const seen = new Set<string>();

    if (index?.files?.length) {
      for (const f of index.files) {
        const row = this.fileToRow(f, filesInArchive);
        if (row) {
          rows.push(row);
          seen.add(row.filename);
        }
      }
    }

    for (const path of filesInArchive.keys()) {
      if (!path.startsWith('package/') || !path.endsWith('.json')) {
        continue;
      }
      if (path.endsWith('package.json') || path.endsWith('.index.json')) {
        continue;
      }
      if (seen.has(path)) {
        continue;
      }
      const synthetic: FhirPackageIndexFile = { filename: path };
      const row = this.fileToRow(synthetic, filesInArchive);
      if (row) {
        rows.push(row);
      }
    }

    return rows.sort((a, b) => a.filename.localeCompare(b.filename));
  }

  private inferResourceType(path: string, files: Map<string, Uint8Array>): string {
    const raw = files.get(path);
    if (!raw) {
      return 'Unknown';
    }
    try {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(raw);
      const t = text.trimStart();
      if (!t.startsWith('{')) {
        return 'Unknown';
      }
      const obj = JSON.parse(text) as { resourceType?: string };
      return (obj.resourceType ?? '').trim() || 'Unknown';
    } catch {
      return 'Unknown';
    }
  }

  private fileToRow(f: FhirPackageIndexFile, files: Map<string, Uint8Array>): IndexedResourceRowVm | null {
    const nameFromIndex = (f.filename ?? '').trim();
    if (!nameFromIndex) {
      return null;
    }
    const archiveKey = resolvePackageArchiveKey(nameFromIndex, files);
    const filename = archiveKey ?? nameFromIndex;
    const fromFile = this.inferResourceType(filename, files);
    let rt = (f.resourceType ?? '').trim() || fromFile;
    if (!rt) {
      rt = 'Unknown';
    }
    if (fromFile === 'CapabilityStatement') {
      rt = 'CapabilityStatement';
    }
    const isExample = filename.includes('/examples/') || filename.includes('\\examples\\');
    const suggested = this.suggestTarget(rt);
    return {
      rowKey: filename,
      filename,
      resourceType: rt,
      id: (f.id ?? '').trim(),
      url: (f.url ?? '').trim(),
      version: (f.version ?? '').trim(),
      kind: (f.kind ?? '').trim(),
      typeField: (f.type ?? '').trim(),
      isExample,
      suggestedTarget: suggested,
      targetTerminology: suggested === 'terminology',
      targetData: suggested === 'data',
      category: this.categoryFor(rt, f.kind, f.type),
      importNote: this.importNoteFor(rt, suggested, isExample),
      selected: this.rowSelectedByDefault(isExample, rt, fromFile)
    };
  }

  /**
   * Default-off for examples, CapabilityStatement, unknown/inferred-missing types, and when the index
   * says `Unknown` but the file parsed as something else.
   */
  private rowSelectedByDefault(
    isExample: boolean,
    resourceType: string,
    inferredFromFile: string
  ): boolean {
    return !(
      isExample ||
      inferredFromFile === 'Unknown' ||
      resourceType === 'Unknown' ||
      resourceType === 'CapabilityStatement'
    );
  }

  private suggestTarget(resourceType: string): SuggestedImportTarget {
    if (TERMINOLOGY_TYPES.has(resourceType)) {
      return 'terminology';
    }
    return 'data';
  }

  private categoryFor(resourceType: string, kind?: string, type?: string): string {
    if (TERMINOLOGY_TYPES.has(resourceType)) {
      return 'Terminology';
    }
    if (resourceType === 'StructureDefinition') {
      const k = (kind ?? '').toLowerCase();
      if (k === 'resource' || k === 'complex-type' || k === 'primitive-type') {
        return 'Profile / structure';
      }
      if (k === 'logical') {
        return 'Logical model';
      }
      return 'Profile / structure';
    }
    if (resourceType === 'ImplementationGuide') {
      return 'IG metadata';
    }
    if (resourceType === 'SearchParameter' || resourceType === 'OperationDefinition') {
      return 'Operations / search';
    }
    if (resourceType === 'CapabilityStatement' || resourceType === 'CompartmentDefinition') {
      return 'Conformance';
    }
    if (resourceType === 'Questionnaire' || resourceType === 'Library') {
      return 'Knowledge / narrative';
    }
    if (type) {
      return `${resourceType} (${type})`;
    }
    return resourceType === 'Unknown' ? 'Other' : resourceType;
  }

  private importNoteFor(
    resourceType: string,
    target: SuggestedImportTarget,
    isExample: boolean
  ): string {
    if (isExample) {
      return 'Example instance; optional for validation/testing.';
    }
    if (target === 'terminology') {
      return 'Typical terminology server artifact (expand/validate).';
    }
    if (resourceType === 'StructureDefinition' || resourceType === 'ImplementationGuide') {
      return 'Conformance resource; requires a FHIR server that stores profiles/IGs.';
    }
    if (resourceType === 'CapabilityStatement') {
      return 'Server capability metadata; off by default—enable only if your FHIR server should store it.';
    }
    if (resourceType === 'Unknown') {
      return 'Could not infer type; confirm before import.';
    }
    return 'Import to FHIR data endpoint for profiles, artifacts, and examples.';
  }

  countByResourceType(rows: IndexedResourceRowVm[]): { resourceType: string; count: number }[] {
    const map = new Map<string, number>();
    for (const r of rows) {
      const k = r.resourceType || 'Unknown';
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return [...map.entries()]
      .map(([resourceType, count]) => ({ resourceType, count }))
      .sort((a, b) => b.count - a.count || a.resourceType.localeCompare(b.resourceType));
  }
}
