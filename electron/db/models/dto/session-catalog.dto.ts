import type { AgentEngineType } from '../../../engines/types';
import type { CatalogSessionType } from '../../../../shared/session-type';

export interface CreateWorkspaceInput {
  id?: string;
  name: string;
  rootPath: string;
  actor?: string | null;
}

export interface UpdateWorkspaceInput {
  name?: string;
  rootPath?: string;
  actor?: string | null;
}

export interface ListWorkspacesOptions {
  includeDeleted?: boolean;
  includeDefault?: boolean;
}

export interface CreateSessionGroupInput {
  id?: string;
  workspaceId: string;
  name: string;
  sortOrder?: number;
  actor?: string | null;
}

export interface UpdateSessionGroupInput {
  name?: string;
  sortOrder?: number;
  actor?: string | null;
}

export interface UpsertCatalogSessionInput {
  workspaceId: string;
  sessionKey: string;
  groupId?: string | null;
  sessionType?: CatalogSessionType | null;
  taskId?: string | null;
  appId?: string | null;
  channelType?: string | null;
  channelId?: string | null;
  title?: string | null;
  pinRank?: number | null;
  sortKey?: string | null;
  lastActivityAt?: string | null;
  actor?: string | null;
}

export interface ListCatalogSessionsOptions {
  workspaceId: string;
  groupId?: string | null;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
}

export interface UpsertEngineBindingInput {
  sessionKey: string;
  engineType: AgentEngineType;
  agentId: string;
  sessionId?: string;
  cwd?: string;
  updatedAt?: number;
  title?: string;
  model?: string;
  provider?: string;
  accountId?: string;
  archivedClaudeSessionIds?: string[];
  pendingHistoryBridge?: boolean;
  actor?: string | null;
}

export interface ListEngineBindingsOptions {
  engineType?: AgentEngineType;
  includeDeleted?: boolean;
}
