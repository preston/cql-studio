// Author: Preston Lee

import { Injectable } from '@angular/core';
import { BaseService } from './base.service';
import { Observable, forkJoin, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { SettingsService } from './settings.service';
import { Parameters } from 'fhir/r4';

export interface CqlExecutionResult {
  result?: any;
  error?: any;
  executionTime: number;
  libraryId: string;
  libraryName: string;
  patientId?: string;
  patientName?: string;
}

@Injectable({
  providedIn: 'root'
})
export class CqlExecutionService extends BaseService {

  constructor(protected override http: HttpClient, protected settingsService: SettingsService) { 
    super(http);
  }

  /**
   * Execute a single library using the $evaluate operation
   */
  executeLibrary(libraryId: string, patientIds?: string[]): Observable<CqlExecutionResult[]> {
    if (!patientIds || patientIds.length === 0) {
      // Execute without patient context
      return this.executeLibraryWithoutPatient(libraryId);
    } else {
      // Execute for each patient
      return this.executeLibraryForPatients(libraryId, patientIds);
    }
  }

  /**
   * Execute library without patient context
   */
  private executeLibraryWithoutPatient(libraryId: string): Observable<CqlExecutionResult[]> {
    const parameters: Parameters = {
      resourceType: 'Parameters',
      parameter: []
    };

    const startTime = Date.now();
    
    return new Observable(observer => {
      this.http.post<Parameters>(this.getLibraryEvaluateUrl(libraryId), JSON.stringify(parameters), { headers: this.headers() })
        .subscribe({
          next: (response: any) => {
            observer.next([{
              result: response,
              executionTime: Date.now() - startTime,
              libraryId: libraryId,
              libraryName: libraryId
            }]);
            observer.complete();
          },
          error: (error: any) => {
            observer.next([{
              error: error,
              executionTime: Date.now() - startTime,
              libraryId: libraryId,
              libraryName: libraryId
            }]);
            observer.complete();
          }
        });
    });
  }

  /**
   * Execute library for multiple patients
   */
  private executeLibraryForPatients(libraryId: string, patientIds: string[]): Observable<CqlExecutionResult[]> {
    const executions = patientIds.map(patientId => {
      const parameters: Parameters = {
        resourceType: 'Parameters',
        parameter: [
          {
            name: 'subject',
            valueString: `Patient/${patientId}`
          }
        ]
      };

      const startTime = Date.now();
      
      return new Observable<CqlExecutionResult>(observer => {
        this.http.post<Parameters>(this.getLibraryEvaluateUrl(libraryId), JSON.stringify(parameters), { headers: this.headers() })
          .subscribe({
            next: (response: any) => {
              observer.next({
                result: response,
                executionTime: Date.now() - startTime,
                libraryId: libraryId,
                libraryName: libraryId,
                patientId: patientId,
                patientName: `Patient ${patientId}`
              });
              observer.complete();
            },
            error: (error: any) => {
              observer.next({
                error: error,
                executionTime: Date.now() - startTime,
                libraryId: libraryId,
                libraryName: libraryId,
                patientId: patientId,
                patientName: `Patient ${patientId}`
              });
              observer.complete();
            }
          });
      });
    });

    return forkJoin(executions);
  }

  /**
   * Execute all libraries
   */
  executeAllLibraries(libraries: Array<{id: string, name: string}>, patientIds?: string[]): Observable<CqlExecutionResult[]> {
    const executions = libraries.map(library => 
      this.executeLibrary(library.id, patientIds)
    );

    return forkJoin(executions).pipe(
      // Flatten the results since each library execution returns an array
      map(results => results.flat())
    );
  }

  /**
   * Get the evaluate URL for a library
   */
  private getLibraryEvaluateUrl(libraryId: string): string {
    const baseUrl = this.settingsService.getEffectiveFhirBaseUrl();
    return `${baseUrl}/Library/${libraryId}/$evaluate`;
  }
}
