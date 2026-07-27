// Author: Eugene Vestel
//
// Loads selected patients' clinical data from the configured FHIR server and
// packages it as a collection Bundle for the SQL-on-FHIR pipeline's PGlite
// seeding (Preston's "patient selection sidebar" starting point on #24).
//
// For each selected patient we pull the resource types the flat schema knows
// about (Encounter, Observation, Procedure, Condition). The result plugs into
// the same { dataKey, bundle, valueSets } seed contract the demo content uses.

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import type { Bundle, BundleEntry, FhirResource, Patient } from 'fhir/r4';
import { SettingsService } from '../settings.service';

/** Per-patient resource types pulled for measure evaluation. */
const RESOURCE_QUERIES = ['Encounter', 'Observation', 'Procedure', 'Condition'] as const;
const PAGE_SIZE = 200;

export interface PatientDataLoad {
  /** Collection bundle: the patients + all fetched clinical resources. */
  bundle: Bundle;
  /** Stable key for PGlite reseeding — changes when the patient set changes. */
  dataKey: string;
  /** Total clinical resources fetched (excludes the Patient resources themselves). */
  resourceCount: number;
  /** Per-type fetch failures, reported rather than silently dropped. */
  errors: string[];
}

@Injectable({ providedIn: 'root' })
export class SqlOnFhirPatientLoaderService {
  private http = inject(HttpClient);
  private settings = inject(SettingsService);

  /**
   * Fetch the given patients' clinical resources from the configured FHIR
   * server. Individual query failures are collected in `errors` — one failing
   * resource type doesn't abort the whole load.
   */
  loadPatients(patients: Patient[]): Observable<PatientDataLoad> {
    const baseUrl = this.settings.getEffectiveDataEndpointAddress().replace(/\/$/, '');
    const ids = patients.map(p => p.id).filter((id): id is string => !!id).sort();

    const queries: Observable<{ entries: BundleEntry[]; error?: string }>[] = [];
    for (const id of ids) {
      for (const type of RESOURCE_QUERIES) {
        const url = `${baseUrl}/${type}?patient=${encodeURIComponent(id)}&_count=${PAGE_SIZE}`;
        queries.push(
          this.http.get<Bundle>(url).pipe(
            map(b => ({ entries: (b.entry ?? []).filter(e => !!e.resource) })),
            catchError((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              return of({ entries: [] as BundleEntry[], error: `${type} for Patient/${id}: ${msg}` });
            }),
          ),
        );
      }
    }

    const patientEntries: BundleEntry[] = patients.map(p => ({
      fullUrl: `Patient/${p.id}`,
      resource: p as FhirResource,
    }));

    if (queries.length === 0) {
      return of({
        bundle: { resourceType: 'Bundle', type: 'collection', entry: patientEntries },
        dataKey: `patients-${ids.join('-')}`,
        resourceCount: 0,
        errors: [],
      });
    }

    return forkJoin(queries).pipe(
      map(results => {
        const clinical = results.flatMap(r => r.entries);
        const errors = results.map(r => r.error).filter((e): e is string => !!e);
        return {
          bundle: {
            resourceType: 'Bundle' as const,
            type: 'collection' as const,
            entry: [...patientEntries, ...clinical],
          },
          dataKey: `patients-${ids.join('-')}`,
          resourceCount: clinical.length,
          errors,
        };
      }),
    );
  }
}
