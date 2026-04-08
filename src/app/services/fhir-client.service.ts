// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Bundle, Resource } from 'fhir/r4';
import { BaseService } from './base.service';
import { SettingsService } from './settings.service';

export type FhirHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

@Injectable({
  providedIn: 'root'
})
export class FhirClientService extends BaseService {
  private readonly settingsService = inject(SettingsService);

  getBaseUrl(): string {
    const url = this.settingsService.getEffectiveFhirBaseUrl();
    return url?.trim()?.replace(/\/+$/, '') ?? '';
  }

  request(method: FhirHttpMethod, path: string, body?: object): Observable<unknown> {
    const baseUrl = this.getBaseUrl();
    let url: string;
    if (path.startsWith('http://') || path.startsWith('https://')) {
      url = path;
    } else {
      const cleanPath = path.startsWith('/') ? path.slice(1) : path;
      url = baseUrl ? `${baseUrl}/${cleanPath}` : path;
    }
    if (!url.startsWith('http')) {
      return new Observable((subscriber) => {
        subscriber.error(new Error('FHIR base URL is not configured'));
      });
    }
    return this.http.request<unknown>(method, url, {
      body: body ?? undefined,
      headers: this.headers()
    });
  }

  private fhirJsonHeaders(): HttpHeaders {
    return new HttpHeaders({
      'Content-Type': 'application/fhir+json',
      Accept: 'application/fhir+json'
    });
  }

  /** POST a Bundle to the FHIR server base URL (same pattern as FHIR Uploader). */
  postBundle(bundle: Bundle<Resource>): Observable<Bundle<Resource>> {
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) {
      return new Observable((subscriber) => {
        subscriber.error(new Error('FHIR base URL is not configured'));
      });
    }
    return this.http.post<Bundle<Resource>>(baseUrl, bundle, {
      headers: this.fhirJsonHeaders()
    });
  }
}
