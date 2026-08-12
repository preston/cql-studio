// Author: Preston Lee

import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { Resource } from 'fhir/r4';
import { WorkspaceService } from '../../../services/workspace.service';
import { TeamService } from '../../../services/team.service';
import { EnvironmentService } from '../../../services/environment.service';
import { EnvironmentSwitchService } from '../../../services/environment-switch.service';
import { FhirSearchService } from '../../../services/fhir-search.service';
import { FhirCapabilityService } from '../../../services/fhir-capability.service';
import {
  buildTextSearchParams,
  resolveBestTextSearchParam,
} from '../../../services/fhir-text-search.lib';
import { SettingsEndpointEditorComponent } from '../../settings/settings-endpoint-editor/settings-endpoint-editor.component';
import { WorkspaceCreateModalComponent } from '../../shared/workspace-create-modal/workspace-create-modal.component';
import { cloneEndpointConfiguration } from '../../../services/endpoint-config.lib';
import { workspaceActivityVerbLabel } from '../../../services/workspace-activity.lib';
import { ToastService } from '../../../services/toast.service';
import {
  SharedEnvironmentConfig,
  SharedEnvironmentDto,
  Team,
  Workspace,
  WorkspaceAccessGrant,
  WorkspaceActivity,
  WorkspacePrincipalType,
  WorkspaceResourceReference,
  WorkspaceRole,
  WorkspaceVisibility,
} from '../../../models/team.model';

type WorkspaceTab = 'resources' | 'environments' | 'activity' | 'settings';

const RESOURCE_TYPE_OPTIONS = [
  'Library',
  'Measure',
  'PlanDefinition',
  'ActivityDefinition',
  'Questionnaire',
  'ValueSet',
  'CodeSystem',
  'Patient',
  'Bundle',
  'StructureDefinition',
];

@Component({
  selector: 'app-team-workspaces',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    RouterLink,
    SettingsEndpointEditorComponent,
    WorkspaceCreateModalComponent,
  ],
  templateUrl: './team-workspaces.component.html',
})
export class TeamWorkspacesComponent implements OnInit {
  private readonly workspaceService = inject(WorkspaceService);
  private readonly teamService = inject(TeamService);
  private readonly environmentService = inject(EnvironmentService);
  private readonly environmentSwitchService = inject(EnvironmentSwitchService);
  private readonly fhirSearch = inject(FhirSearchService);
  private readonly fhirCapability = inject(FhirCapabilityService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private detailLoadToken = 0;

  readonly resourceTypeOptions = RESOURCE_TYPE_OPTIONS;

  readonly workspaces = signal<Workspace[]>([]);
  readonly teams = signal<Team[]>([]);
  readonly selected = signal<Workspace | null>(null);
  readonly grants = signal<WorkspaceAccessGrant[]>([]);
  readonly environments = signal<SharedEnvironmentDto[]>([]);
  readonly resources = signal<WorkspaceResourceReference[]>([]);
  readonly activity = signal<WorkspaceActivity[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly detailError = signal('');
  readonly activeTab = signal<WorkspaceTab>('resources');
  readonly showCreateModal = signal(false);
  readonly showDeleteModal = signal(false);

  readonly editName = signal('');
  readonly editDescription = signal('');

  readonly grantType = signal<WorkspacePrincipalType>('USER');
  readonly grantPrincipal = signal('');
  readonly grantRole = signal<WorkspaceRole>('VIEWER');

  readonly resourceFilter = signal('');
  readonly searchResourceType = signal('Library');
  readonly searchQuery = signal('');
  readonly searchResults = signal<Resource[]>([]);
  readonly searchLoading = signal(false);
  readonly searchError = signal('');
  readonly manualResourceType = signal('Library');
  readonly manualResourceId = signal('');
  readonly manualCanonicalUrl = signal('');
  readonly manualDisplayName = signal('');

  readonly envEditorMode = signal<'idle' | 'create' | 'edit'>('idle');
  readonly editingEnvId = signal<string | null>(null);
  readonly editingEnvName = signal('');
  readonly editingEnvConfig = signal<SharedEnvironmentConfig>(this.environmentService.emptySharedConfig());

  readonly isOwner = computed(() => this.selected()?.myRole === 'OWNER');
  readonly canEdit = computed(() => {
    const role = this.selected()?.myRole;
    return role === 'OWNER' || role === 'EDITOR';
  });

  readonly filteredResources = computed(() => {
    const q = this.resourceFilter().trim().toLowerCase();
    const items = this.resources();
    if (!q) {
      return items;
    }
    return items.filter((ref) => {
      const haystack = [
        ref.resourceType,
        ref.resourceId,
        ref.displayName ?? '',
        ref.canonicalUrl ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  });

  readonly searchQueryPlaceholder = computed(() => {
    const type = this.searchResourceType();
    const params = this.fhirCapability.getSearchParamsForType(type);
    const resolved = resolveBestTextSearchParam(type, params);
    return resolved ? `${resolved.label} search` : 'Search';
  });

  async ngOnInit(): Promise<void> {
    void this.fhirCapability.ensureMetadataLoaded();
    await this.reloadList();
    this.route.paramMap.subscribe(async (params) => {
      const id = params.get('workspaceId');
      if (id) {
        await this.loadDetail(id);
      } else {
        this.selected.set(null);
        this.closeDeleteModal();
      }
    });
  }

  openCreateModal(): void {
    this.showCreateModal.set(true);
  }

  openDeleteModal(): void {
    this.showDeleteModal.set(true);
  }

  closeDeleteModal(): void {
    this.showDeleteModal.set(false);
  }

  setTab(tab: WorkspaceTab): void {
    this.activeTab.set(tab);
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

  private async fetchActivity(workspaceId: string): Promise<WorkspaceActivity[]> {
    const page = await this.workspaceService.activity({ workspaceId, pageSize: 50 });
    return page.items;
  }

  async loadDetail(id: string): Promise<void> {
    const token = ++this.detailLoadToken;
    this.detailError.set('');
    this.envEditorMode.set('idle');
    this.editingEnvId.set(null);
    try {
      const workspace = await this.workspaceService.get(id);
      if (token !== this.detailLoadToken) {
        return;
      }
      this.selected.set(workspace);
      this.editName.set(workspace.name);
      this.editDescription.set(workspace.description ?? '');
      this.closeDeleteModal();
      const [grants, environments, resources, activity] = await Promise.all([
        this.workspaceService.listGrants(id),
        this.workspaceService.listEnvironments(id),
        this.workspaceService.listResources(id),
        this.workspaceService.activity({ workspaceId: id, pageSize: 50 }),
      ]);
      if (token !== this.detailLoadToken) {
        return;
      }
      this.grants.set(grants);
      this.environments.set(environments);
      this.resources.set(resources);
      this.activity.set(activity.items);
      const previousKey = this.environmentSwitchService.currentSelectionKey();
      this.environmentService.replaceWorkspaceEnvironments(id, environments, workspace.name);
      this.environmentSwitchService.afterCatalogMutation(previousKey);
    } catch (e) {
      if (token !== this.detailLoadToken) {
        return;
      }
      this.detailError.set((e as Error).message || 'Failed to load workspace');
      this.selected.set(null);
    }
  }

  async onWorkspaceCreated(ws: Workspace): Promise<void> {
    this.showCreateModal.set(false);
    await this.reloadList();
    await this.router.navigate(['/team/workspaces', ws.id]);
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
      this.activity.set(await this.fetchActivity(ws.id));
    } catch (e) {
      this.detailError.set((e as Error).message || 'Failed to update visibility');
    }
  }

  async saveWorkspaceDetails(): Promise<void> {
    const ws = this.selected();
    const name = this.editName().trim();
    if (!ws || !name) {
      return;
    }
    try {
      const updated = await this.workspaceService.update(ws.id, {
        name,
        description: this.editDescription().trim() || null,
      });
      this.selected.set(updated);
      this.editName.set(updated.name);
      this.editDescription.set(updated.description ?? '');
      await this.reloadList();
      await this.environmentSwitchService.reloadWorkspaceCatalog();
      this.activity.set(await this.fetchActivity(ws.id));
    } catch (e) {
      this.detailError.set((e as Error).message || 'Failed to update workspace');
    }
  }

  async confirmDeleteWorkspace(): Promise<void> {
    const ws = this.selected();
    if (!ws) {
      return;
    }
    try {
      await this.workspaceService.delete(ws.id);
      this.closeDeleteModal();
      this.selected.set(null);
      await this.reloadList();
      await this.environmentSwitchService.reloadWorkspaceCatalog();
      await this.router.navigate(['/team/workspaces']);
    } catch (e) {
      this.closeDeleteModal();
      this.detailError.set((e as Error).message || 'Failed to delete workspace');
    }
  }

  setGrantType(type: WorkspacePrincipalType): void {
    this.grantType.set(type);
    this.grantPrincipal.set('');
  }

  grantLabel(grant: WorkspaceAccessGrant): string {
    if (grant.principalType === 'USER') {
      const email = grant.principalEmail?.trim();
      const name = grant.principalDisplayName?.trim();
      if (email && name) {
        return `${name} <${email}>`;
      }
      return email || name || grant.principalId;
    }
    return grant.principalName?.trim() || grant.principalId;
  }

  async addGrant(): Promise<void> {
    const ws = this.selected();
    const principal = this.grantPrincipal().trim();
    if (!ws || !principal) {
      return;
    }
    try {
      if (this.grantType() === 'USER') {
        await this.workspaceService.upsertGrant(ws.id, {
          type: 'USER',
          email: principal,
          role: this.grantRole(),
        });
      } else {
        await this.workspaceService.upsertGrant(ws.id, {
          type: 'TEAM',
          id: principal,
          role: this.grantRole(),
        });
      }
      this.grantPrincipal.set('');
      this.grants.set(await this.workspaceService.listGrants(ws.id));
      this.activity.set(await this.fetchActivity(ws.id));
    } catch (e) {
      this.toast.showError((e as Error).message || 'Failed to add grant');
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
      this.activity.set(await this.fetchActivity(ws.id));
    } catch (e) {
      this.detailError.set((e as Error).message || 'Failed to remove grant');
    }
  }

  async searchResources(): Promise<void> {
    const resourceType = this.searchResourceType().trim();
    const query = this.searchQuery().trim();
    if (!resourceType) {
      return;
    }
    this.searchLoading.set(true);
    this.searchError.set('');
    try {
      await this.fhirCapability.ensureMetadataLoaded();
      const params = buildTextSearchParams(
        resourceType,
        query,
        this.fhirCapability.getSearchParamsForType(resourceType)
      );
      const bundle = await firstValueFrom(
        this.fhirSearch.search(resourceType, params, { count: 20 })
      );
      const results = (bundle.entry ?? [])
        .map((e) => e.resource)
        .filter((r): r is Resource => !!r && !!r.resourceType && !!r.id);
      this.searchResults.set(results);
    } catch (e) {
      this.searchResults.set([]);
      this.searchError.set((e as Error).message || 'FHIR search failed');
    } finally {
      this.searchLoading.set(false);
    }
  }

  async addResourceFromSearch(resource: Resource): Promise<void> {
    const ws = this.selected();
    if (!ws || !resource.resourceType || !resource.id) {
      return;
    }
    const withMeta = resource as Resource & { url?: string; name?: string | { text?: string }; title?: string };
    const displayName =
      (typeof withMeta.name === 'string' ? withMeta.name : withMeta.name?.text) ||
      withMeta.title ||
      resource.id;
    try {
      await this.workspaceService.addResource(ws.id, {
        resourceType: resource.resourceType,
        resourceId: resource.id,
        canonicalUrl: withMeta.url ?? null,
        displayName: displayName ?? null,
      });
      this.resources.set(await this.workspaceService.listResources(ws.id));
      this.activity.set(await this.fetchActivity(ws.id));
    } catch (e) {
      this.detailError.set((e as Error).message || 'Failed to add resource');
    }
  }

  async addManualResource(): Promise<void> {
    const ws = this.selected();
    const resourceType = this.manualResourceType().trim();
    const resourceId = this.manualResourceId().trim();
    if (!ws || !resourceType || !resourceId) {
      return;
    }
    try {
      await this.workspaceService.addResource(ws.id, {
        resourceType,
        resourceId,
        canonicalUrl: this.manualCanonicalUrl().trim() || null,
        displayName: this.manualDisplayName().trim() || null,
      });
      this.manualResourceId.set('');
      this.manualCanonicalUrl.set('');
      this.manualDisplayName.set('');
      this.resources.set(await this.workspaceService.listResources(ws.id));
      this.activity.set(await this.fetchActivity(ws.id));
    } catch (e) {
      this.detailError.set((e as Error).message || 'Failed to add resource');
    }
  }

  async deleteResource(refId: string): Promise<void> {
    const ws = this.selected();
    if (!ws) {
      return;
    }
    try {
      await this.workspaceService.deleteResource(ws.id, refId);
      this.resources.set(await this.workspaceService.listResources(ws.id));
      this.activity.set(await this.fetchActivity(ws.id));
    } catch (e) {
      this.detailError.set((e as Error).message || 'Failed to remove resource');
    }
  }

  startCreateEnvironment(): void {
    this.envEditorMode.set('create');
    this.editingEnvId.set(null);
    this.editingEnvName.set('');
    this.editingEnvConfig.set(this.environmentService.emptySharedConfig());
  }

  startEditEnvironment(env: SharedEnvironmentDto): void {
    this.envEditorMode.set('edit');
    this.editingEnvId.set(env.id);
    this.editingEnvName.set(env.name);
    this.editingEnvConfig.set({
      evaluationServer: cloneEndpointConfiguration(env.config.evaluationServer),
      dataEndpoint: cloneEndpointConfiguration(env.config.dataEndpoint),
      terminologyEndpoint: cloneEndpointConfiguration(env.config.terminologyEndpoint),
      contentEndpoint: cloneEndpointConfiguration(env.config.contentEndpoint),
    });
  }

  cancelEnvEditor(): void {
    this.envEditorMode.set('idle');
    this.editingEnvId.set(null);
  }

  copyActiveIntoEditor(): void {
    const active = this.environmentService.activeEnvironment();
    this.editingEnvConfig.set(this.environmentService.scrubbedConfigFromEnvironment(active));
    if (!this.editingEnvName().trim()) {
      this.editingEnvName.set(active.name.replace(/\s*\(.*\)\s*$/, '').trim() || 'Shared environment');
    }
  }

  async saveEnvironment(): Promise<void> {
    const ws = this.selected();
    const name = this.editingEnvName().trim();
    if (!ws || !name) {
      return;
    }
    const config = this.editingEnvConfig();
    try {
      if (this.envEditorMode() === 'edit' && this.editingEnvId()) {
        await this.workspaceService.updateEnvironment(ws.id, this.editingEnvId()!, {
          name,
          config,
        });
      } else {
        await this.workspaceService.createEnvironment(ws.id, name, config);
      }
      const environments = await this.workspaceService.listEnvironments(ws.id);
      this.environments.set(environments);
      await this.environmentSwitchService.reloadWorkspaceCatalog();
      this.activity.set(await this.fetchActivity(ws.id));
      this.cancelEnvEditor();
    } catch (e) {
      this.detailError.set((e as Error).message || 'Failed to save environment');
    }
  }

  async deleteEnvironment(envId: string): Promise<void> {
    const ws = this.selected();
    if (!ws) {
      return;
    }
    try {
      const previousKey = this.environmentSwitchService.currentSelectionKey();
      await this.workspaceService.deleteEnvironment(ws.id, envId);
      const environments = await this.workspaceService.listEnvironments(ws.id);
      this.environments.set(environments);
      this.environmentService.replaceWorkspaceEnvironments(ws.id, environments, ws.name);
      this.environmentSwitchService.afterCatalogMutation(previousKey);
      await this.environmentSwitchService.reloadWorkspaceCatalog();
      this.activity.set(await this.fetchActivity(ws.id));
      if (this.editingEnvId() === envId) {
        this.cancelEnvEditor();
      }
    } catch (e) {
      this.detailError.set((e as Error).message || 'Failed to delete environment');
    }
  }

  actorLabel(item: WorkspaceActivity): string {
    return item.actor?.displayName || item.actor?.email || item.actorUserId;
  }

  verbLabel(verb: string): string {
    return workspaceActivityVerbLabel(verb);
  }

  resourceLabel(resource: Resource): string {
    const withMeta = resource as Resource & { name?: string | { text?: string }; title?: string };
    if (typeof withMeta.name === 'string' && withMeta.name.trim()) {
      return withMeta.name;
    }
    if (withMeta.name && typeof withMeta.name === 'object' && withMeta.name.text) {
      return withMeta.name.text;
    }
    if (withMeta.title?.trim()) {
      return withMeta.title;
    }
    return resource.id || 'Untitled';
  }
}
