// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { BaseService } from './base.service';
import { Observable, forkJoin, of, defer } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { HttpHeaders } from '@angular/common/http';
import { SettingsService } from './settings.service';
import { Parameters, Library } from 'fhir/r4';
import { LibraryResource } from '../components/cql-ide/shared/ide-types';
import { buildHttpHeaders } from './endpoint-config.lib';
import { appendEvaluateEndpointParameters } from './cql-evaluate-parameters.lib';

export type CqlOperationType = '$evaluate' | '$cql';

export interface CqlExecutionResult {
  result?: any;
  error?: any;
  executionTime: number;
  libraryId?: string;
  libraryName: string;
  patientId?: string;
  patientName?: string;
  functionName?: string;
}

export interface CqlExecutionOptions {
  operation?: CqlOperationType;
  functionName?: string;
  cqlExpression?: string;
  cqlContent?: string;
  elmXml?: string;
  libraryResource?: LibraryResource;
  libraryName?: string;
  libraryTitle?: string;
  libraryVersion?: string;
  libraryUrl?: string;
  libraryDescription?: string;
  library?: Library;
}

@Injectable({
  providedIn: 'root'
})
export class CqlExecutionService extends BaseService {

  protected settingsService = inject(SettingsService);

  executeLibrary(libraryId: string, patientIds?: string[], options?: CqlExecutionOptions): Observable<CqlExecutionResult[]> {
    const operation = options?.operation || '$evaluate';
    
    if (operation === '$cql') {
      return this.executeLibraryWithCqlOperation(libraryId, patientIds, options);
    } else {
      return this.executeLibraryWithEvaluateOperation(libraryId, patientIds, options);
    }
  }

  private executeLibraryWithEvaluateOperation(libraryId: string, patientIds?: string[], options?: CqlExecutionOptions): Observable<CqlExecutionResult[]> {
    if (!patientIds || patientIds.length === 0) {
      return this.executeLibraryWithoutPatient(libraryId, options);
    } else {
      return this.executeLibraryForPatients(libraryId, patientIds, options);
    }
  }

  private executeLibraryWithCqlOperation(libraryId: string, patientIds?: string[], options?: CqlExecutionOptions): Observable<CqlExecutionResult[]> {
    if (!patientIds || patientIds.length === 0) {
      return this.executeCqlWithoutPatient(libraryId, options);
    } else {
      return this.executeCqlForPatients(libraryId, patientIds, options);
    }
  }

  private executeLibraryWithoutPatient(libraryId: string, options?: CqlExecutionOptions): Observable<CqlExecutionResult[]> {
    const parameters = this.createBaseParameters();
    return this.executeHttpRequest(
      this.getLibraryEvaluateUrl(libraryId),
      parameters,
      { libraryId, libraryName: options?.libraryName || libraryId }
    ).pipe(
      map(result => [result])
    );
  }

  private executeLibraryForPatients(libraryId: string, patientIds: string[], options?: CqlExecutionOptions): Observable<CqlExecutionResult[]> {
    const executions = patientIds
      .filter(patientId => patientId && patientId.trim().length > 0)
      .map(patientId => {
        const parameters = this.createBaseParameters();
        this.addSubjectParameter(parameters, patientId);
        return this.executeHttpRequest(
          this.getLibraryEvaluateUrl(libraryId),
          parameters,
          { libraryId, libraryName: options?.libraryName || libraryId, patientId, patientName: `Patient ${patientId}` }
        );
      });

    return forkJoin(executions);
  }

  private executeCqlWithoutPatient(libraryId: string, options?: CqlExecutionOptions): Observable<CqlExecutionResult[]> {
    const parameters = this.createBaseParameters();
    this.addLibraryParameter(parameters, libraryId);
    this.addExpressionParameter(parameters, options);
    return this.executeHttpRequest(
      this.getCqlOperationUrl(),
      parameters,
      { libraryId, libraryName: libraryId, functionName: options?.functionName }
    ).pipe(
      map(result => [result])
    );
  }

  private executeCqlForPatients(libraryId: string, patientIds: string[], options?: CqlExecutionOptions): Observable<CqlExecutionResult[]> {
    const executions = patientIds.map(patientId => {
      const parameters = this.createBaseParameters();
      this.addLibraryParameter(parameters, libraryId);
      this.addSubjectParameter(parameters, patientId);
      this.addExpressionParameter(parameters, options);
      return this.executeHttpRequest(
        this.getCqlOperationUrl(),
        parameters,
        { libraryId, libraryName: libraryId, patientId, patientName: `Patient ${patientId}`, functionName: options?.functionName }
      );
    });

    return forkJoin(executions);
  }

  executeAllLibraries(libraries: Array<{id: string, name: string}>, patientIds?: string[], options?: CqlExecutionOptions): Observable<CqlExecutionResult[]> {
    const executions = libraries.map(library => 
      this.executeLibrary(library.id, patientIds, options)
    );

    return forkJoin(executions).pipe(
      map(results => results.flat())
    );
  }

  private getLibraryEvaluateUrl(libraryId: string): string {
    const baseUrl = this.settingsService.getEffectiveEvaluationServerUrl();
    return `${baseUrl}/Library/${libraryId}/$evaluate`;
  }

  private getCqlOperationUrl(): string {
    const baseUrl = this.settingsService.getEffectiveEvaluationServerUrl();
    return `${baseUrl}/$cql`;
  }

  private evaluationHeaders(): HttpHeaders {
    const ctx = this.settingsService.getEndpointHttpContext('evaluation', {
      'Content-Type': 'application/fhir+json',
      Accept: 'application/fhir+json'
    });
    return buildHttpHeaders(
      { ...this.settingsService.getActiveEnvironment().evaluationServer, address: ctx.address },
      ctx.headers
    );
  }

  private createBaseParameters(): Parameters {
    const parameters: Parameters = {
      resourceType: 'Parameters',
      parameter: []
    };
    appendEvaluateEndpointParameters(parameters, this.settingsService.getActiveEnvironment());
    return parameters;
  }

  private addSubjectParameter(parameters: Parameters, patientId: string): void {
    parameters.parameter!.push({
      name: 'subject',
      valueString: `Patient/${patientId}`
    });
  }

  private addLibraryParameter(parameters: Parameters, libraryId: string): void {
    parameters.parameter!.push({
      name: 'library',
      valueString: libraryId
    });
  }

  private addExpressionParameter(parameters: Parameters, options?: CqlExecutionOptions): void {
    if (options?.functionName) {
      parameters.parameter!.push({
        name: 'expression',
        valueString: options.functionName
      });
    } else if (options?.cqlExpression) {
      parameters.parameter!.push({
        name: 'expression',
        valueString: options.cqlExpression
      });
    }
  }

  private executeHttpRequest(
    url: string,
    parameters: Parameters,
    metadata: Partial<CqlExecutionResult>
  ): Observable<CqlExecutionResult> {
    const baseResult: Partial<CqlExecutionResult> = {
      libraryName: metadata.libraryName || metadata.libraryId || 'Unknown',
      ...metadata
    };

    return defer(() => {
      const startTime = Date.now();
      const fhirHeaders = this.evaluationHeaders();

      return this.http.post<any>(url, parameters, { headers: fhirHeaders }).pipe(
        map((response: any) => {
          return {
            result: response,
            ...baseResult,
            executionTime: Date.now() - startTime
          } as CqlExecutionResult;
        }),
        catchError((error: any) => {
          return of({
            error: error,
            ...baseResult,
            executionTime: Date.now() - startTime
          } as CqlExecutionResult);
        })
      );
    });
  }
}
