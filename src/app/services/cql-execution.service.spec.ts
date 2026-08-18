// Author: Preston Lee

import { describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { CqlExecutionService } from './cql-execution.service';
import { IdeExecutionSubject } from '../models/ide-context.model';

function createCqlExecutionService() {
  const service = Object.create(CqlExecutionService.prototype) as CqlExecutionService;
  service.settingsService = {
    getEffectiveEvaluationServerUrl: () => 'http://localhost/fhir',
    getEndpointHttpContext: () => ({ address: 'http://localhost/fhir', headers: {} }),
    getActiveEnvironment: () => ({
      evaluationServer: { address: 'http://localhost/fhir' },
      dataEndpoint: { address: '' },
      terminologyEndpoint: { address: '' },
      contentEndpoint: { address: '' }
    })
  };
  service.http = {
    post: vi.fn(() => of({ resourceType: 'Parameters', parameter: [] }))
  };
  return service;
}

describe('CqlExecutionService', () => {
  it('posts Group subject reference to Library/$evaluate', () => {
    const service = createCqlExecutionService();
    const subjects: IdeExecutionSubject[] = [{
      reference: 'Group/g1',
      id: 'g1',
      display: 'Cohort'
    }];

    service.executeLibrary('lib1', subjects, { libraryName: 'Lib' }).subscribe();

    expect(service.http.post).toHaveBeenCalledTimes(1);
    const [, body] = (service.http.post as ReturnType<typeof vi.fn>).mock.calls[0];
    const subjectParam = body.parameter.find((p: { name: string }) => p.name === 'subject');
    expect(subjectParam.valueString).toBe('Group/g1');
  });

  it('omits subject when no subjects are provided', () => {
    const service = createCqlExecutionService();
    service.executeLibrary('lib1').subscribe();
    const [, body] = (service.http.post as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(body.parameter.some((p: { name: string }) => p.name === 'subject')).toBe(false);
  });

  it('fans out one request per subject', () => {
    const service = createCqlExecutionService();
    const subjects: IdeExecutionSubject[] = [
      { reference: 'Patient/p1', id: 'p1', display: 'Pat 1' },
      { reference: 'Patient/p2', id: 'p2', display: 'Pat 2' }
    ];

    service.executeLibrary('lib1', subjects).subscribe(results => {
      expect(results).toHaveLength(2);
    });

    expect(service.http.post).toHaveBeenCalledTimes(2);
  });

  it('omits expression when the expressions array is empty', () => {
    const service = createCqlExecutionService();
    service.executeLibrary('lib1', undefined, { expressions: [] }).subscribe();
    const [, body] = (service.http.post as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(body.parameter.some((p: { name: string }) => p.name === 'expression')).toBe(false);
  });

  it('repeats expression parameters for custom evaluation', () => {
    const service = createCqlExecutionService();
    const subjects: IdeExecutionSubject[] = [
      { reference: 'Patient/p1', id: 'p1', display: 'Pat 1' },
      { reference: 'Patient/p2', id: 'p2', display: 'Pat 2' }
    ];

    service.executeLibrary('lib1', subjects, {
      expressions: ['Foo', 'Encounter Eligibility Results']
    }).subscribe();

    expect(service.http.post).toHaveBeenCalledTimes(2);
    for (const [, body] of (service.http.post as ReturnType<typeof vi.fn>).mock.calls) {
      const expressionValues = body.parameter
        .filter((p: { name: string }) => p.name === 'expression')
        .map((p: { valueString: string }) => p.valueString);
      expect(expressionValues).toEqual(['Foo', 'Encounter Eligibility Results']);
      expect(body.parameter.some((p: { name: string }) => p.name === 'subject')).toBe(true);
    }
  });

  it('sends expression parameters when evaluating without a subject', () => {
    const service = createCqlExecutionService();
    service.executeLibrary('lib1', undefined, { expressions: ['Foo'] }).subscribe();
    const [, body] = (service.http.post as ReturnType<typeof vi.fn>).mock.calls[0];
    const expressionValues = body.parameter
      .filter((p: { name: string }) => p.name === 'expression')
      .map((p: { valueString: string }) => p.valueString);
    expect(expressionValues).toEqual(['Foo']);
    expect(body.parameter.some((p: { name: string }) => p.name === 'subject')).toBe(false);
  });
});
