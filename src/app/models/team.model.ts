// Author: Preston Lee

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
  isGuest: boolean;
  grantedByUserId: string | null;
  createdAt: string;
}

export interface WorkspaceShareLink {
  id: string;
  workspaceId: string;
  tokenHash: string;
  createdByUserId: string;
  expiresAt: string | null;
  revokedAt: string | null;
  useCount: number;
  maxUses: number | null;
  createdAt: string;
  token?: string;
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
  actor?: { id: string; email: string | null; displayName: string | null };
  workspace?: { id: string; name: string; slug: string };
}

export interface SharedEnvironmentDto {
  id: string;
  workspaceId: string;
  name: string;
  config: unknown;
  createdAt: string;
  updatedAt: string;
}
