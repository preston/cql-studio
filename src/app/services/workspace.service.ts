// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';
import {
  SharedEnvironmentDto,
  Workspace,
  WorkspaceAccessGrant,
  WorkspaceActivity,
  WorkspacePrincipalType,
  WorkspaceRole,
  WorkspaceShareLink,
  WorkspaceVisibility,
} from '../models/team.model';

@Injectable({
  providedIn: 'root'
})
export class WorkspaceService {
  private readonly auth = inject(AuthService);

  private url(path: string): string {
    return `${this.auth.apiBase()}/api/workspaces${path}`;
  }

  private async json<T>(res: Response): Promise<T> {
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error || res.statusText);
    }
    if (res.status === 204) {
      return undefined as T;
    }
    return res.json() as Promise<T>;
  }

  list(): Promise<Workspace[]> {
    return fetch(this.url(''), { credentials: 'include' }).then((r) => this.json(r));
  }

  get(id: string): Promise<Workspace> {
    return fetch(this.url(`/${id}`), { credentials: 'include' }).then((r) => this.json(r));
  }

  create(input: {
    name: string;
    description?: string;
    visibility?: WorkspaceVisibility;
  }): Promise<Workspace> {
    return fetch(this.url(''), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then((r) => this.json(r));
  }

  update(
    id: string,
    input: Partial<{ name: string; description: string | null; visibility: WorkspaceVisibility }>
  ): Promise<Workspace> {
    return fetch(this.url(`/${id}`), {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then((r) => this.json(r));
  }

  delete(id: string): Promise<void> {
    return fetch(this.url(`/${id}`), {
      method: 'DELETE',
      credentials: 'include',
    }).then((r) => this.json(r));
  }

  listGrants(workspaceId: string): Promise<WorkspaceAccessGrant[]> {
    return fetch(this.url(`/${workspaceId}/grants`), { credentials: 'include' }).then((r) =>
      this.json(r)
    );
  }

  upsertGrant(
    workspaceId: string,
    principal: { type: WorkspacePrincipalType; id: string; role: WorkspaceRole }
  ): Promise<WorkspaceAccessGrant> {
    return fetch(this.url(`/${workspaceId}/grants`), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(principal),
    }).then((r) => this.json(r));
  }

  updateGrant(
    workspaceId: string,
    grantId: string,
    role: WorkspaceRole
  ): Promise<WorkspaceAccessGrant> {
    return fetch(this.url(`/${workspaceId}/grants/${grantId}`), {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    }).then((r) => this.json(r));
  }

  deleteGrant(workspaceId: string, grantId: string): Promise<void> {
    return fetch(this.url(`/${workspaceId}/grants/${grantId}`), {
      method: 'DELETE',
      credentials: 'include',
    }).then((r) => this.json(r));
  }

  createShareLink(
    workspaceId: string,
    opts?: { expiresInDays?: number; maxUses?: number }
  ): Promise<WorkspaceShareLink> {
    return fetch(this.url(`/${workspaceId}/share-links`), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts ?? {}),
    }).then((r) => this.json(r));
  }

  listShareLinks(workspaceId: string): Promise<WorkspaceShareLink[]> {
    return fetch(this.url(`/${workspaceId}/share-links`), { credentials: 'include' }).then((r) =>
      this.json(r)
    );
  }

  revokeShareLink(workspaceId: string, linkId: string): Promise<void> {
    return fetch(this.url(`/${workspaceId}/share-links/${linkId}`), {
      method: 'DELETE',
      credentials: 'include',
    }).then((r) => this.json(r));
  }

  redeemShareLink(token: string): Promise<{ workspaceId: string }> {
    return fetch(this.url(`/redeem/${encodeURIComponent(token)}`), {
      method: 'POST',
      credentials: 'include',
    }).then((r) => this.json(r));
  }

  listEnvironments(workspaceId: string): Promise<SharedEnvironmentDto[]> {
    return fetch(this.url(`/${workspaceId}/environments`), { credentials: 'include' }).then((r) =>
      this.json(r)
    );
  }

  createEnvironment(
    workspaceId: string,
    name: string,
    config: unknown
  ): Promise<SharedEnvironmentDto> {
    return fetch(this.url(`/${workspaceId}/environments`), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, config }),
    }).then((r) => this.json(r));
  }

  updateEnvironment(
    workspaceId: string,
    envId: string,
    input: { name?: string; config?: unknown }
  ): Promise<SharedEnvironmentDto> {
    return fetch(this.url(`/${workspaceId}/environments/${envId}`), {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then((r) => this.json(r));
  }

  deleteEnvironment(workspaceId: string, envId: string): Promise<void> {
    return fetch(this.url(`/${workspaceId}/environments/${envId}`), {
      method: 'DELETE',
      credentials: 'include',
    }).then((r) => this.json(r));
  }

  activity(workspaceId?: string, limit = 50): Promise<WorkspaceActivity[]> {
    const base = workspaceId
      ? this.url(`/${workspaceId}/activity?limit=${limit}`)
      : `${this.auth.apiBase()}/api/activity?limit=${limit}`;
    return fetch(base, { credentials: 'include' }).then((r) => this.json(r));
  }
}
