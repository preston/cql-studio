// Author: Preston Lee

import { EndpointConfiguration } from './environment.model';

export interface AuthUser {
  id: string;
  email: string | null;
  displayName: string | null;
}

export type TeamMemberRole = 'ADMIN' | 'MEMBER';
export type WorkspaceVisibility = 'PRIVATE' | 'PUBLIC';
export type WorkspaceRole = 'OWNER' | 'EDITOR' | 'VIEWER';
export type WorkspacePrincipalType = 'USER' | 'TEAM';

export interface Team {
  id: string;
  name: string;
  slug: string;
  createdByUserId: string;
  createdAt: string;
  myRole?: TeamMemberRole;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  visibility: WorkspaceVisibility;
  description: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  myRole?: WorkspaceRole | null;
}

export interface WorkspaceAccessGrant {
  id: string;
  workspaceId: string;
  principalType: WorkspacePrincipalType;
  principalId: string;
  role: WorkspaceRole;
  grantedByUserId: string | null;
  createdAt: string;
  principalEmail?: string | null;
  principalDisplayName?: string | null;
  principalName?: string | null;
}

export interface WorkspaceActivity {
  id: string;
  workspaceId: string;
  actorUserId: string;
  verb: string;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
  actor?: { id: string; email: string | null; displayName: string | null };
  workspace?: { id: string; name: string; slug: string };
}

/** Sort fields indexed on the server (WorkspaceActivity DateTime columns). */
export type WorkspaceActivitySortBy = 'createdAt' | 'updatedAt';
export type WorkspaceActivitySortOrder = 'asc' | 'desc';

export const WORKSPACE_ACTIVITY_PAGE_SIZES = [10, 25, 50, 100] as const;

export interface WorkspaceActivityPageQuery {
  workspaceId?: string;
  page?: number;
  pageSize?: number;
  sortBy?: WorkspaceActivitySortBy;
  sortOrder?: WorkspaceActivitySortOrder;
}

export interface WorkspaceActivityPage {
  items: WorkspaceActivity[];
  total: number;
  page: number;
  pageSize: number;
  sortBy: WorkspaceActivitySortBy;
  sortOrder: WorkspaceActivitySortOrder;
}

export type WorkspaceActivityStatsRange = '7d' | '30d' | '90d';
export type WorkspaceActivityStatsInterval = 'day' | 'week';
export type WorkspaceActivityStatsMetric = 'series' | 'byActor' | 'byVerb';

export const WORKSPACE_ACTIVITY_STATS_RANGES = [
  { value: '7d' as const, label: 'Last 7 days' },
  { value: '30d' as const, label: 'Last 30 days' },
  { value: '90d' as const, label: 'Last 90 days' },
];

export const WORKSPACE_ACTIVITY_STATS_INTERVALS = [
  { value: 'day' as const, label: 'Day' },
  { value: 'week' as const, label: 'Week' },
];

export const WORKSPACE_ACTIVITY_STATS_TOP_OPTIONS = [5, 10, 20] as const;

export interface WorkspaceActivityStatsQuery {
  workspaceId?: string;
  range?: WorkspaceActivityStatsRange;
  interval?: WorkspaceActivityStatsInterval;
  top?: number;
  metrics?: WorkspaceActivityStatsMetric[];
}

export interface WorkspaceActivityStats {
  range: WorkspaceActivityStatsRange;
  interval: WorkspaceActivityStatsInterval;
  from: string;
  to: string;
  series?: { bucket: string; count: number }[];
  byActor?: {
    actorUserId: string;
    displayName: string | null;
    email: string | null;
    count: number;
  }[];
  byVerb?: { verb: string; count: number }[];
}

export interface SharedEnvironmentConfig {
  evaluationServer: EndpointConfiguration;
  dataEndpoint: EndpointConfiguration;
  terminologyEndpoint: EndpointConfiguration;
  contentEndpoint: EndpointConfiguration;
}

export interface SharedEnvironmentDto {
  id: string;
  workspaceId: string;
  name: string;
  config: SharedEnvironmentConfig;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceResourceReference {
  id: string;
  workspaceId: string;
  resourceType: string;
  resourceId: string;
  canonicalUrl: string | null;
  displayName: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}
