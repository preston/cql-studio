// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SettingsService } from './settings.service';
import {
  FhirNpmPackageManifest,
  FhirPackageCatalogEntry
} from '../models/fhir-package-registry.types';

@Injectable({
  providedIn: 'root'
})
export class FhirPackageRegistryService {
  private readonly http = inject(HttpClient);
  private readonly settingsService = inject(SettingsService);

  private jsonHeaders(): HttpHeaders {
    return new HttpHeaders({
      Accept: 'application/json',
      'Content-Type': 'application/json'
    });
  }

  /**
   * Catalog search. Pass `name` and/or `fhirVersion` (registry `FhirVersion` query param).
   * At least one should be non-empty for useful results.
   */
  async searchCatalog(
    nameQuery: string,
    fhirVersion?: string | null
  ): Promise<FhirPackageCatalogEntry[]> {
    const base = this.settingsService.getEffectiveFhirPackageRegistryBaseUrl();
    const params = new URLSearchParams();
    const name = nameQuery.trim();
    if (name) {
      params.set('name', name);
    }
    const fv = fhirVersion?.trim();
    if (fv) {
      params.set('FhirVersion', fv);
    }
    const url = `${base}/catalog?${params.toString()}`;
    const res = await firstValueFrom(
      this.http.get<FhirPackageCatalogEntry[]>(url, { headers: this.jsonHeaders() })
    );
    return Array.isArray(res) ? res : [];
  }

  async getPackageManifest(packageId: string): Promise<FhirNpmPackageManifest> {
    const base = this.settingsService.getEffectiveFhirPackageRegistryBaseUrl();
    const url = `${base}/${encodeURIComponent(packageId)}`;
    const res = await firstValueFrom(
      this.http.get<FhirNpmPackageManifest>(url, {
        headers: this.jsonHeaders().set('Accept', 'application/json')
      })
    );
    return res;
  }

  private assertTarballUrlHttp(tarballUrl: string): void {
    let u: URL;
    try {
      u = new URL(tarballUrl);
    } catch {
      throw new Error('Invalid package download URL.');
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      throw new Error('Unsupported package download URL scheme.');
    }
  }

  async fetchTarball(tarballUrl: string): Promise<ArrayBuffer> {
    this.assertTarballUrlHttp(tarballUrl);
    const res = await fetch(tarballUrl, { method: 'GET' });
    if (!res.ok) {
      throw new Error(`Package download failed: HTTP ${res.status}`);
    }
    return res.arrayBuffer();
  }
}
