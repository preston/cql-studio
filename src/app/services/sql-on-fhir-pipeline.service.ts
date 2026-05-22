// Author: Eugene Vestel
//
// Orchestrates the SQL-on-FHIR pipeline:
//   ELM JSON  ──▶  ElmToSqlTranspiler  ──▶  SQL (Postgres)
//   SQL       ──▶  SqlOnFhirPgliteService (in-browser Postgres)  ──▶  rows
//   rows      ──▶  generateMeasureReport  ──▶  FHIR R4 MeasureReport
//
// Replaces the previous stub. Resolves Issue #16's wiring half: the elm-to-sql
// library is no longer dead code in the production bundle.

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, defer, from, of, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import type { Bundle, Library, MeasureReport } from 'fhir/r4';
import {
  ElmToSqlTranspiler,
  generateMeasureReport as buildMeasureReport,
  sqlRowToPopulationCounts,
  type PopulationCounts,
} from '../components/sql-on-fhir/elm-to-sql';
import {
  flattenBundle,
  flattenValueSets,
  type FlatTables,
} from './sql-on-fhir-bundle-flattener.lib';
import { SqlOnFhirPgliteService } from './sql-on-fhir-pglite.service';
import type { ValueSet } from 'fhir/r4';
import { SettingsService } from './settings.service';

export interface GenerateSqlResult {
  sql: string;
  populations: string[];
  warnings: string[];
}

export interface ExecuteSqlResult {
  /** Raw JSON of the first row (population counts), formatted for the UI. */
  raw: string;
  /** Parsed population counts ready to feed to MeasureReport generation. */
  counts: PopulationCounts;
  /** Wall-clock execution time. */
  durationMs: number;
}

@Injectable({ providedIn: 'root' })
export class SqlOnFhirPipelineService {
  private readonly http = inject(HttpClient);
  private readonly pg = inject(SqlOnFhirPgliteService);
  private readonly settings = inject(SettingsService);

  /**
   * Transpile ELM JSON to SQL. Returns the SQL plus the populations the library
   * detected — useful for the UI to label CTE results.
   */
  generateSql(elmJson: string, library: Library | null): Observable<GenerateSqlResult> {
    return defer(() => {
      if (!elmJson || !elmJson.trim()) {
        return throwError(() => new Error('ELM JSON is empty — translation did not produce output.'));
      }
      try {
        const elm = JSON.parse(elmJson);
        const period = inferMeasurementPeriod(library);
        const transpiler = new ElmToSqlTranspiler({
          measurementPeriodStart: period.start,
          measurementPeriodEnd: period.end,
        });
        const { sql, populations, warnings } = transpiler.transpile(elm);
        return of<GenerateSqlResult>({ sql, populations, warnings: warnings ?? [] });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return throwError(() => new Error(`SQL generation failed: ${msg}`));
      }
    });
  }

  /**
   * Seed pglite with the provided data set (bundle + value sets), then run the SQL.
   * Returns the first row's column values as parsed PopulationCounts plus the JSON
   * the UI displays.
   */
  executeSql(
    sql: string,
    seedData: { dataKey: string; bundle: Bundle; valueSets: ValueSet[] },
  ): Observable<ExecuteSqlResult> {
    return defer(async () => {
      const tables = mergeFlatTables(flattenBundle(seedData.bundle), {
        value_set_expansion: flattenValueSets(seedData.valueSets),
      });
      await this.pg.seed(seedData.dataKey, tables);
      const { rows, durationMs } = await this.pg.execute(sql);
      const firstRow = rows[0] ?? {};
      const counts = sqlRowToPopulationCounts(firstRow);
      return {
        raw: JSON.stringify(firstRow, null, 2),
        counts,
        durationMs,
      } satisfies ExecuteSqlResult;
    }).pipe(catchError(err => throwError(() => mapPgliteError(err))));
  }

  /**
   * Generate a FHIR R4 MeasureReport from population counts. No network calls.
   */
  generateMeasureReport(counts: PopulationCounts, library: Library | null): Observable<MeasureReport> {
    return defer(() => {
      const period = inferMeasurementPeriod(library);
      const measureUrl =
        library?.url ??
        (library?.id ? `Library/${library.id}` : 'http://cqlstudio.com/Library/unknown');
      const report = buildMeasureReport(counts, {
        measureUrl,
        periodStart: isoDate(period.start),
        periodEnd: isoDate(period.end),
        type: 'summary',
      }) as unknown as MeasureReport;
      return of(report);
    });
  }

  /**
   * POST the MeasureReport to the configured FHIR server. The server is the one
   * set in user settings (CQL_STUDIO_FHIR_BASE_URL). Returns the persisted resource
   * (server-assigned id / meta).
   */
  saveMeasureReport(report: MeasureReport): Observable<MeasureReport> {
    const baseUrl = this.settings.settings().fhirBaseUrl?.trim();
    if (!baseUrl) {
      return throwError(() => new Error('No FHIR base URL configured — set one in Settings to save.'));
    }
    return this.http.post<MeasureReport>(
      `${baseUrl.replace(/\/$/, '')}/MeasureReport`,
      report,
      { headers: { 'Content-Type': 'application/fhir+json', Accept: 'application/fhir+json' } },
    );
  }

  /** True when a FHIR base URL is configured; drives Save button visibility. */
  canSaveMeasureReport(): boolean {
    return !!this.settings.settings().fhirBaseUrl?.trim();
  }
}

function inferMeasurementPeriod(library: Library | null): { start: string; end: string } {
  const periodParam = library?.parameter?.find(p => p.name === 'Measurement Period');
  const fromExt = periodParam?.extension?.find(e => e.url?.endsWith('cqf-defaultValue'))?.valuePeriod;
  if (fromExt?.start && fromExt?.end) {
    return { start: fromExt.start, end: fromExt.end };
  }
  return { start: '2024-01-01T00:00:00Z', end: '2024-12-31T23:59:59Z' };
}

function isoDate(s: string): string {
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function mergeFlatTables(a: FlatTables, b: Partial<FlatTables>): FlatTables {
  return {
    patient_view: a.patient_view,
    encounter_view: a.encounter_view,
    observation_view: a.observation_view,
    procedure_view: a.procedure_view,
    condition_view: a.condition_view,
    value_set_expansion: (b.value_set_expansion ?? []).concat(a.value_set_expansion),
  };
}

function mapPgliteError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(String(err));
}
