// Author: Preston Lee

import { Injectable, computed, signal } from '@angular/core';
import {
  BUILT_IN_ENVIRONMENT_ID,
  CqlEnvironment,
  EndpointConfiguration,
  EndpointHttpContext,
  EndpointRole
} from '../models/environment.model';
import {
  buildHttpHeaders,
  emptyEndpointConfiguration,
  getEffectiveAddress,
  normalizeEndpointAddress,
  normalizeEndpointConfiguration
} from './endpoint-config.lib';

export interface LegacyEnvironmentFields {
  fhirBaseUrl?: string;
  terminologyBaseUrl?: string;
  terminologyBasicAuthUsername?: string;
  terminologyBasicAuthPassword?: string;
}

@Injectable({
  providedIn: 'root'
})
export class EnvironmentService {
  private readonly _environments = signal<CqlEnvironment[]>([]);
  private readonly _activeEnvironmentId = signal<string>(BUILT_IN_ENVIRONMENT_ID);

  readonly environments = this._environments.asReadonly();
  readonly activeEnvironmentId = this._activeEnvironmentId.asReadonly();
  readonly activeEnvironment = computed(() => {
    const id = this._activeEnvironmentId();
    return this._environments().find(env => env.id === id) ?? this._environments()[0] ?? this.seedBuiltInEnvironment();
  });

  syncFromSettings(environments: CqlEnvironment[], activeEnvironmentId: string): void {
    const normalized = this.normalizeEnvironments(environments);
    this._environments.set(normalized);
    this._activeEnvironmentId.set(this.resolveActiveEnvironmentId(activeEnvironmentId, normalized));
  }

  getEnvironmentsSnapshot(): CqlEnvironment[] {
    return this._environments().map(env => this.cloneEnvironment(env));
  }

  getActiveEnvironmentIdSnapshot(): string {
    return this._activeEnvironmentId();
  }

  resolveActiveEnvironmentIdForImport(id: string | undefined, environments: CqlEnvironment[]): string {
    return this.resolveActiveEnvironmentId(id ?? '', environments);
  }

  setActiveEnvironment(id: string): CqlEnvironment | null {
    const env = this._environments().find(e => e.id === id);
    if (!env) {
      return null;
    }
    this._activeEnvironmentId.set(id);
    return env;
  }

  updateEnvironment(updated: CqlEnvironment): void {
    this._environments.update(envs =>
      envs.map(env => (env.id === updated.id ? this.cloneEnvironment(updated) : env))
    );
  }

  duplicateEnvironment(id: string): CqlEnvironment | null {
    const source = this._environments().find(env => env.id === id);
    if (!source) {
      return null;
    }
    const copy = this.cloneEnvironment(source);
    copy.id = crypto.randomUUID();
    copy.name = `${source.name} (copy)`;
    copy.builtIn = false;
    this._environments.update(envs => [...envs, copy]);
    return copy;
  }

  deleteEnvironment(id: string): boolean {
    const target = this._environments().find(env => env.id === id);
    if (!target || target.builtIn || this._environments().length <= 1) {
      return false;
    }
    this._environments.update(envs => envs.filter(env => env.id !== id));
    if (this._activeEnvironmentId() === id) {
      this._activeEnvironmentId.set(BUILT_IN_ENVIRONMENT_ID);
    }
    return true;
  }

  resetBuiltInEnvironment(): CqlEnvironment {
    const seeded = this.seedBuiltInEnvironment();
    this._environments.update(envs =>
      envs.map(env => (env.builtIn ? seeded : env))
    );
    return seeded;
  }

  migrateLegacySettings(legacy: LegacyEnvironmentFields): { environments: CqlEnvironment[]; activeEnvironmentId: string } {
    const builtIn = this.buildBuiltInFromLegacy(legacy);
    return { environments: [builtIn], activeEnvironmentId: builtIn.id };
  }

  seedBuiltInEnvironment(): CqlEnvironment {
    return this.buildBuiltInFromLegacy({});
  }

  getEndpointConfiguration(role: EndpointRole): EndpointConfiguration {
    const env = this.activeEnvironment();
    switch (role) {
      case 'evaluation':
        return env.evaluationServer;
      case 'data':
        return env.dataEndpoint;
      case 'terminology':
        return env.terminologyEndpoint;
      case 'content':
        return env.contentEndpoint;
    }
  }

  getEffectiveAddressForRole(role: EndpointRole): string {
    const env = this.activeEnvironment();
    const evaluationAddress = this.getDeployDefaultEvaluationServerUrl();
    switch (role) {
      case 'evaluation':
        return getEffectiveAddress(env.evaluationServer, evaluationAddress);
      case 'data':
        return getEffectiveAddress(
          env.dataEndpoint,
          getEffectiveAddress(env.evaluationServer, evaluationAddress)
        );
      case 'terminology':
        return getEffectiveAddress(
          env.terminologyEndpoint,
          getEffectiveAddress(env.evaluationServer, evaluationAddress)
        );
      case 'content':
        return getEffectiveAddress(
          env.contentEndpoint,
          getEffectiveAddress(env.evaluationServer, evaluationAddress)
        );
    }
  }

  getEndpointHttpContext(role: EndpointRole, baseHeaders?: Record<string, string>): EndpointHttpContext {
    const config = this.getEndpointConfiguration(role);
    const address = this.getEffectiveAddressForRole(role);
    const headers = buildHttpHeaders({ ...config, address }, baseHeaders);
    const headerRecord: Record<string, string> = {};
    headers.keys().forEach(key => {
      const value = headers.get(key);
      if (value != null) {
        headerRecord[key] = value;
      }
    });
    return { address, headers: headerRecord };
  }

  private buildBuiltInFromLegacy(legacy: LegacyEnvironmentFields): CqlEnvironment {
    const evaluationDefault = this.getDeployDefaultEvaluationServerUrl();
    const terminologyDefault = this.getDeployDefaultTerminologyUrl();
    const contentDefault = this.getDeployDefaultContentUrl();
    const dataDefault = this.getDeployDefaultDataUrl();

    return {
      id: BUILT_IN_ENVIRONMENT_ID,
      name: 'Default Environment',
      builtIn: true,
      evaluationServer: normalizeEndpointConfiguration({
        address: legacy.fhirBaseUrl?.trim() || evaluationDefault
      }),
      dataEndpoint: normalizeEndpointConfiguration({
        address: dataDefault
      }),
      terminologyEndpoint: normalizeEndpointConfiguration({
        address: legacy.terminologyBaseUrl?.trim() || terminologyDefault,
        basicAuthUsername:
          legacy.terminologyBasicAuthUsername?.trim() || this.getDeployDefaultTerminologyAuthUsername(),
        basicAuthPassword: legacy.terminologyBasicAuthPassword ?? this.getDeployDefaultTerminologyAuthPassword()
      }),
      contentEndpoint: normalizeEndpointConfiguration({
        address: contentDefault
      })
    };
  }

  private normalizeEnvironments(environments: CqlEnvironment[]): CqlEnvironment[] {
    if (!environments?.length) {
      return [this.seedBuiltInEnvironment()];
    }
    return environments.map(env => this.cloneEnvironment(env));
  }

  private resolveActiveEnvironmentId(id: string, environments: CqlEnvironment[]): string {
    if (id && environments.some(env => env.id === id)) {
      return id;
    }
    const builtIn = environments.find(env => env.builtIn);
    return builtIn?.id ?? environments[0]?.id ?? BUILT_IN_ENVIRONMENT_ID;
  }

  private cloneEnvironment(env: CqlEnvironment): CqlEnvironment {
    return {
      id: env.id,
      name: env.name,
      builtIn: env.builtIn,
      evaluationServer: normalizeEndpointConfiguration(env.evaluationServer ?? emptyEndpointConfiguration()),
      dataEndpoint: normalizeEndpointConfiguration(env.dataEndpoint ?? emptyEndpointConfiguration()),
      terminologyEndpoint: normalizeEndpointConfiguration(env.terminologyEndpoint ?? emptyEndpointConfiguration()),
      contentEndpoint: normalizeEndpointConfiguration(env.contentEndpoint ?? emptyEndpointConfiguration())
    };
  }

  private getDeployDefaultEvaluationServerUrl(): string {
    const evalUrl = (window as unknown as Record<string, string | undefined>)['CQL_STUDIO_EVALUATION_SERVER_URL'];
    if (evalUrl?.trim()) {
      return normalizeEndpointAddress(evalUrl);
    }
    const fhirUrl = (window as unknown as Record<string, string | undefined>)['CQL_STUDIO_FHIR_BASE_URL'];
    return fhirUrl?.trim() ? normalizeEndpointAddress(fhirUrl) : 'http://localhost:8080/fhir';
  }

  private getDeployDefaultDataUrl(): string {
    const dataUrl = (window as unknown as Record<string, string | undefined>)['CQL_STUDIO_DATA_ENDPOINT_URL'];
    return dataUrl?.trim() ? normalizeEndpointAddress(dataUrl) : '';
  }

  private getDeployDefaultContentUrl(): string {
    const contentUrl = (window as unknown as Record<string, string | undefined>)['CQL_STUDIO_CONTENT_ENDPOINT_URL'];
    return contentUrl?.trim() ? normalizeEndpointAddress(contentUrl) : '';
  }

  private getDeployDefaultTerminologyUrl(): string {
    const envValue = (window as unknown as Record<string, string | undefined>)['CQL_STUDIO_TERMINOLOGY_BASE_URL'];
    return envValue?.trim() ? normalizeEndpointAddress(envValue) : '';
  }

  private getDeployDefaultTerminologyAuthUsername(): string {
    const envValue = (window as unknown as Record<string, string | undefined>)['CQL_STUDIO_TERMINOLOGY_BASIC_AUTH_USERNAME'];
    return envValue?.trim() ?? '';
  }

  private getDeployDefaultTerminologyAuthPassword(): string {
    const envValue = (window as unknown as Record<string, string | undefined>)['CQL_STUDIO_TERMINOLOGY_BASIC_AUTH_PASSWORD'];
    return envValue ?? '';
  }
}
