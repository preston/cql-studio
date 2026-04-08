// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import {
  FhirPackageIndexJson,
  FhirPackageJson
} from '../models/fhir-package-registry.types';
import { IndexedResourceRowVm, PackageSummaryVm } from '../models/fhir-package-view.model';
import { FhirPackageRegistryService } from './fhir-package-registry.service';
import { FhirPackageTarService } from './fhir-package-tar.service';
import { FhirPackageMetadataService } from './fhir-package-metadata.service';

export interface ParsedFhirPackageTarball {
  files: Map<string, Uint8Array>;
  pkgJson: FhirPackageJson;
  /** Name from package.json (or fallback). */
  packageName: string;
  summary: PackageSummaryVm;
  rows: IndexedResourceRowVm[];
}

@Injectable({
  providedIn: 'root'
})
export class FhirPackageLoadService {
  private readonly registry = inject(FhirPackageRegistryService);
  private readonly tar = inject(FhirPackageTarService);
  private readonly metadata = inject(FhirPackageMetadataService);

  async fetchAndParseTarball(
    tarballUrl: string,
    jsonNameFallback: string,
    rowKeyScope?: string
  ): Promise<ParsedFhirPackageTarball> {
    const buf = await this.registry.fetchTarball(tarballUrl);
    return this.parseTarballBuffer(buf, jsonNameFallback, rowKeyScope);
  }

  parseTarballBuffer(
    tgzBytes: ArrayBuffer,
    jsonNameFallback: string,
    rowKeyScope?: string
  ): ParsedFhirPackageTarball {
    const files = this.tar.extractTarGz(tgzBytes);
    return this.parseExtractedFiles(files, jsonNameFallback, rowKeyScope);
  }

  /**
   * @param jsonNameFallback — used when `package.json` omits `name`.
   * @param rowKeyScope — if set, row keys use this (registry/dependency key); otherwise uses resolved package name.
   */
  parseExtractedFiles(
    files: Map<string, Uint8Array>,
    jsonNameFallback: string,
    rowKeyScope?: string
  ): ParsedFhirPackageTarball {
    const raw = this.utf8File(files, 'package/package.json');
    if (!raw) {
      throw new Error('package/package.json not found in archive.');
    }
    const pkgJson = JSON.parse(raw) as FhirPackageJson;
    const packageName = (pkgJson.name ?? jsonNameFallback).trim();
    const scope = (rowKeyScope ?? packageName).trim();
    const summary = this.metadata.buildPackageSummary(pkgJson);
    let index: FhirPackageIndexJson | null = null;
    const indexRaw = this.utf8File(files, 'package/.index.json');
    if (indexRaw) {
      try {
        index = JSON.parse(indexRaw) as FhirPackageIndexJson;
      } catch {
        index = null;
      }
    }
    const rawRows = this.metadata.buildIndexedRows(index, files);
    const rows = this.scopeRowsForPackage(scope, rawRows);
    return { files, pkgJson, packageName, summary, rows };
  }

  readPackageJsonFromFiles(files: Map<string, Uint8Array>): FhirPackageJson {
    const raw = this.utf8File(files, 'package/package.json');
    if (!raw) {
      throw new Error('package/package.json missing from loaded package.');
    }
    return JSON.parse(raw) as FhirPackageJson;
  }

  private scopeRowsForPackage(packageName: string, rows: IndexedResourceRowVm[]): IndexedResourceRowVm[] {
    return rows.map((r) => ({
      ...r,
      rowKey: `${packageName}::${r.filename}`
    }));
  }

  private utf8File(files: Map<string, Uint8Array>, path: string): string | null {
    const u8 = files.get(path);
    if (!u8) {
      return null;
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(u8);
  }
}
