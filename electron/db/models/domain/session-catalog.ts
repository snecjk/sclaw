import type { AgentEngineType } from '../../../engines/types';
import type { CatalogSessionType } from '../../../../shared/session-type';

export const DEFAULT_WORKSPACE_ID = 'default';

export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface SessionGroup {
  id: string;
  workspaceId: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface CatalogSession {
  workspaceId: string;
  sessionKey: string;
  groupId: string | null;
  sessionType: CatalogSessionType;
  taskId: string | null;
  appId: string | null;
  channelType: string | null;
  channelId: string | null;
  title: string | null;
  pinRank: number | null;
  sortKey: string | null;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface SessionEngineBinding {
  sessionKey: string;
  engineType: AgentEngineType;
  agentId: string;
  engineSessionId: string | null;
  cwd: string | null;
  model: string | null;
  provider: string | null;
  accountId: string | null;
  extra: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
}
