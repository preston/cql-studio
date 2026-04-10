// Author: Preston Lee

import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { Library, MeasureReport } from 'fhir/r4';

/**
 * Stub pipeline for SQL-on-FHIR: ELM translation, SQL generation, execution, and MeasureReport.
 * Replace when ELM-to-SQL (#16) and CQL Studio Server SQL APIs exist. Emits synchronously (no artificial delay).
 */
@Injectable({
  providedIn: 'root'
})
export class SqlOnFhirPipelineService {

  generateSql(_elmXml: string, library: Library | null): Observable<string> {
    const id = library?.id ?? 'unknown-id';
    const sql =
      `-- Stub SQL (SQL-on-FHIR) for Library/${id}\n` +
      `SELECT patient_id, observation_code, effective_datetime\n` +
      `FROM fhir.Observation_flat\n` +
      `WHERE category = 'survey'\n` +
      `LIMIT 100;\n`;
    return of(sql);
  }

  executeSql(_sql: string): Observable<string> {
    const raw =
      '{\n' +
      '  "_stub": true,\n' +
      '  "rowCount": 3,\n' +
      '  "columns": ["patient_id", "observation_code", "cnt"],\n' +
      '  "rows": [\n' +
      '    ["Patient/example-1", "44249-1", 2],\n' +
      '    ["Patient/example-2", "44249-1", 1],\n' +
      '    ["Patient/example-3", "72166-2", 4]\n' +
      '  ]\n' +
      '}';
    return of(raw);
  }

  generateMeasureReport(_sqlResultsRaw: string, library: Library | null): Observable<MeasureReport> {
    const measureRef =
      library?.url ?? (library?.id ? `Library/${library.id}` : 'Library/unknown');
    const report: MeasureReport = {
      resourceType: 'MeasureReport',
      id: `stub-report-${Date.now()}`,
      status: 'complete',
      type: 'summary',
      measure: measureRef,
      period: {
        start: '2024-01-01',
        end: '2024-12-31'
      },
      group: [
        {
          id: 'group-1',
          population: [
            {
              id: 'pop-initial',
              code: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/measure-population', code: 'initial-population' }] },
              count: 42
            }
          ],
          measureScore: { value: 0.87 }
        }
      ],
      text: {
        status: 'generated',
        div: '<div xmlns="http://www.w3.org/1999/xhtml">Stub MeasureReport from SQL-on-FHIR pipeline.</div>'
      }
    };
    return of(report);
  }

  saveMeasureReport(report: MeasureReport): Observable<MeasureReport> {
    return of({
      ...report,
      id: report.id ?? `saved-${Date.now()}`,
      meta: {
        ...report.meta,
        versionId: '1',
        lastUpdated: new Date().toISOString()
      }
    }).pipe(map(r => JSON.parse(JSON.stringify(r)) as MeasureReport));
  }
}
