// Author: Preston Lee

import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { WorkspaceService } from '../../../services/workspace.service';
import { TeamService } from '../../../services/team.service';
import { EnvironmentService } from '../../../services/environment.service';
import {
  SharedEnvironmentDto,
  Team,
  Workspace,
  WorkspaceAccessGrant,
  WorkspacePrincipalType,
  WorkspaceRole,
  WorkspaceShareLink,
  WorkspaceVisibility,
} from '../../../models/team.model';

@Component({
  selector: 'app-team-workspaces',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink],
  templateUrl: './team-workspaces.component.html',
})
export class TeamWorkspacesComponent implements OnInit {
  private readonly workspaceService = inject(WorkspaceService);
  private readonly teamService = inject(TeamService);
  private readonly environmentService = inject(EnvironmentService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly workspaces = signal<Workspace[]>([]);
  readonly teams = signal<Team[]>([]);
  readonly selected = signal<Workspace | null>(null);
  readonly grants = signal<WorkspaceAccessGrant[]>([]);
  readonly shareLinks = signal<WorkspaceShareLink[]>([]);
  readonly environments = signal<SharedEnvironmentDto[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly detailError = signal('');

  readonly newName = signal('');
  readonly newDescription = signal('');
  readonly newVisibility = signal<WorkspaceVisibility>('PRIVATE');

  readonly grantType = signal<WorkspacePrincipalType>('USER');
  readonly grantPrincipalId = signal('');
  readonly grantRole = signal<WorkspaceRole>('VIEWER');

  readonly newEnvName = signal('');
  readonly lastShareToken = signal('');

  readonly isOwner = computed(() => this.selected()?.myRole === 'OWNER');
  readonly canEdit = computed(() => {
    const role = this.selected()?.myRole;
    return role === 'OWNER' || role === 'EDITOR';
  });

  async ngOnInit(): Promise<void> {
    await this.reloadList();
    this.route.paramMap.subscribe(async (params) => {
      const id = params.get('workspaceId');
      if (id) {
        await this.loadDetail(id);
      } else {
        this.selected.set(null);
      }
    });
  }

  async reloadList(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const [workspaces, teams] = await Promise.all([
        this.workspaceService.list(),
        this.teamService.list().catch(() => [] as Team[]),
      ]);
      this.workspaces.set(workspaces);
      this.teams.set(teams);
    } catch (e) {
      this.error.set((e as Error).message || 'Failed to load workspaces');
    } finally {
      this.loading.set(false);
    }
  }

  async loadDetail(id: string): Promise<void> {
    this.detailError.set('');
    try {
      const workspace = await this.workspaceService.get(id);
      this.selected.set(workspace);
      const [grants, environments] = await Promise.all([
        this.workspaceService.listGrants(id),
        this.workspaceService.listEnvironments(id),
      ]);
      this.grants.set(grants);
      this.environments.set(environments);
      if (workspace.myRole === 'OWNER') {
        this.shareLinks.set(await this.workspaceService.listShareLinks(id));
      } else {
        this.shareLinks.set([]);
      }
    } catch (e) {
      this.detailError.set((e as Error).message || 'Failed to load workspace');
      this.selected.set(null);
    }
  }

  async createWorkspace(): Promise<void> {
    const name = this.newName().trim();
    if (!name) {
      return;
    }
    try {
      const ws = await this.workspaceService.create({
        name,
        description: this.newDescription().trim() || undefined,
        visibility: this.newVisibility(),
      });
      this.newName.set('');
      this.newDescription.set('');
      await this.reloadList();
      await this.router.navigate(['/team/workspaces', ws.id]);
    } catch (e) {
      this.error.set((e as Error).message || 'Failed to create workspace');
    }
  }

  async saveVisibility(visibility: WorkspaceVisibility): Promise<void> {
    const ws = this.selected();
    if (!ws) {
      return;
    }
    try {
      const updated = await this.workspaceService.update(ws.id, { visibility });
      this.selected.set(updated);
      await this.reloadList();
    } catch (e) {
      this.detailError.set((e as Error).message || 'Failed to update visibility');
    }
  }

  async addGrant(): Promise<void> {
    const ws = this.selected();
    const id = this.grantPrincipalId().trim();
    if (!ws || !id) {
      return;
    }
    try {
      await this.workspaceService.upsertGrant(ws.id, {
        type: this.grantType(),
        id,
        role: this.grantRole(),
      });
      this.grantPrincipalId.set('');
      this.grants.set(await this.workspaceService.listGrants(ws.id));
    } catch (e) {
      this.detailError.set((e as Error).message || 'Failed to add grant');
    }
  }

  async removeGrant(grantId: string): Promise<void> {
    const ws = this.selected();
    if (!ws) {
      return;
    }
    try {
      await this.workspaceService.deleteGrant(ws.id, grantId);
      this.grants.set(await this.workspaceService.listGrants(ws.id));
    } catch (e) {
      this.detailError.set((e as Error).message || 'Failed to remove grant');
    }
  }

  async createShareLink(): Promise<void> {
    const ws = this.selected();
    if (!ws) {
      return;
    }
    try {
      const link = await this.workspaceService.createShareLink(ws.id, { expiresInDays: 7 });
      this.lastShareToken.set(link.token || '');
      this.shareLinks.set(await this.workspaceService.listShareLinks(ws.id));
    } catch (e) {
      this.detailError.set((e as Error).message || 'Failed to create share link');
    }
  }

  async revokeShareLink(linkId: string): Promise<void> {
    const ws = this.selected();
    if (!ws) {
      return;
    }
    try {
      await this.workspaceService.revokeShareLink(ws.id, linkId);
      this.shareLinks.set(await this.workspaceService.listShareLinks(ws.id));
    } catch (e) {
      this.detailError.set((e as Error).message || 'Failed to revoke share link');
    }
  }

  async shareActiveEnvironment(): Promise<void> {
    const ws = this.selected();
    const name = this.newEnvName().trim();
    if (!ws || !name) {
      return;
    }
    try {
      const env = this.environmentService.activeEnvironment();
      await this.workspaceService.createEnvironment(ws.id, name, {
        evaluationServer: {
          address: env.evaluationServer.address,
          headers: env.evaluationServer.headers,
        },
        dataEndpoint: {
          address: env.dataEndpoint.address,
          headers: env.dataEndpoint.headers,
        },
        terminologyEndpoint: {
          address: env.terminologyEndpoint.address,
          headers: env.terminologyEndpoint.headers,
        },
        contentEndpoint: {
          address: env.contentEndpoint.address,
          headers: env.contentEndpoint.headers,
        },
      });
      this.newEnvName.set('');
      this.environments.set(await this.workspaceService.listEnvironments(ws.id));
    } catch (e) {
      this.detailError.set((e as Error).message || 'Failed to share environment');
    }
  }

  async deleteEnvironment(envId: string): Promise<void> {
    const ws = this.selected();
    if (!ws) {
      return;
    }
    try {
      await this.workspaceService.deleteEnvironment(ws.id, envId);
      this.environments.set(await this.workspaceService.listEnvironments(ws.id));
    } catch (e) {
      this.detailError.set((e as Error).message || 'Failed to delete environment');
    }
  }

  async createTeam(): Promise<void> {
    const name = window.prompt('Team name');
    if (!name?.trim()) {
      return;
    }
    try {
      await this.teamService.create(name.trim());
      this.teams.set(await this.teamService.list());
    } catch (e) {
      this.error.set((e as Error).message || 'Failed to create team');
    }
  }
}
