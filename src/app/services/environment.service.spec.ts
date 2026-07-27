// Author: Preston Lee

import { describe, expect, it, beforeEach } from 'vitest';
import { EnvironmentService } from './environment.service';
import { BUILT_IN_ENVIRONMENT_ID } from '../models/environment.model';

describe('EnvironmentService', () => {
  let service: EnvironmentService;

  beforeEach(() => {
    service = new EnvironmentService();
    service.syncFromSettings([], BUILT_IN_ENVIRONMENT_ID);
  });

  it('seeds built-in environment when list is empty', () => {
    const envs = service.environments();
    expect(envs.length).toBe(1);
    expect(envs[0].id).toBe(BUILT_IN_ENVIRONMENT_ID);
    expect(envs[0].builtIn).toBe(true);
    expect(envs[0].dataEndpoint.address).toBe('');
    expect(envs[0].terminologyEndpoint.address).toBe('');
    expect(envs[0].contentEndpoint.address).toBe('');
    expect(envs[0].evaluationServer.address).toBeTruthy();
  });

  it('migrates legacy flat settings into built-in environment', () => {
    const migrated = service.migrateLegacySettings({
      fhirBaseUrl: 'http://legacy/fhir',
      terminologyBaseUrl: 'http://legacy/term',
      terminologyBasicAuthUsername: 'user',
      terminologyBasicAuthPassword: 'pass'
    });
    expect(migrated.environments).toHaveLength(1);
    expect(migrated.environments[0].evaluationServer.address).toBe('http://legacy/fhir');
    expect(migrated.environments[0].dataEndpoint.address).toBe('');
    expect(migrated.environments[0].terminologyEndpoint.headers).toContain(
      `Authorization: Basic ${btoa('user:pass')}`
    );
  });

  it('duplicates environment with new id and copy suffix', () => {
    const copy = service.duplicateEnvironment(BUILT_IN_ENVIRONMENT_ID);
    expect(copy).not.toBeNull();
    expect(copy!.id).not.toBe(BUILT_IN_ENVIRONMENT_ID);
    expect(copy!.name).toContain('(copy)');
    expect(copy!.builtIn).toBeFalsy();
    expect(service.environments().length).toBe(2);
  });

  it('cannot delete built-in environment', () => {
    expect(service.deleteEnvironment(BUILT_IN_ENVIRONMENT_ID)).toBe(false);
  });

  it('resolves effective addresses with role fallbacks', () => {
    service.updateEnvironment({
      ...service.activeEnvironment(),
      evaluationServer: { address: 'http://eval/fhir' },
      dataEndpoint: { address: '' },
      terminologyEndpoint: { address: 'http://term/fhir' },
      contentEndpoint: { address: '' }
    });
    expect(service.getEffectiveAddressForRole('evaluation')).toBe('http://eval/fhir');
    expect(service.getEffectiveAddressForRole('data')).toBe('http://eval/fhir');
    expect(service.getEffectiveAddressForRole('terminology')).toBe('http://term/fhir');
    expect(service.getEffectiveAddressForRole('content')).toBe('http://eval/fhir');
  });

  it('builds HTTP context with authorization headers', () => {
    service.updateEnvironment({
      ...service.activeEnvironment(),
      terminologyEndpoint: {
        address: 'http://term/fhir',
        headers: [`Authorization: Basic ${btoa('u:p')}`]
      }
    });
    const ctx = service.getEndpointHttpContext('terminology');
    expect(ctx.address).toBe('http://term/fhir');
    expect(ctx.headers['Authorization']).toBe(`Basic ${btoa('u:p')}`);
  });
});
