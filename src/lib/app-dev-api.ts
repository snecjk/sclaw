/**
 * Renderer API for user app development (OpenSpec change: app-dev-workbench-mvp).
 * All calls go through host-api — never direct IPC / Gateway.
 */
import { hostApiFetch } from '@/lib/host-api';

export type NodeRuntimeState = 'ready' | 'not-installed' | 'downloading' | 'extracting' | 'error';

export interface NodeRuntimeStatus {
  state: NodeRuntimeState;
  version: string;
  receivedBytes: number;
  totalBytes: number;
  error?: string;
}

export type AppDevPhase =
  | 'created' | 'preparing-env' | 'installing' | 'starting' | 'ready' | 'stopped' | 'error';

export interface AppDevStatus {
  workspaceId: string;
  appPath: string;
  phase: AppDevPhase;
  progress: number;
  previewUrl?: string;
  error?: string;
}

export interface AppDevEnvironment {
  nodeRuntime: NodeRuntimeStatus;
  gitAvailable: boolean;
  defaultParentDir: string;
}

export interface AppCheckpoint {
  hash: string;
  subject: string;
  timestamp: number;
}

export interface DevAppSummary {
  workspaceId: string;
  name: string;
  appPath: string;
  projectType: string;
  createdAt: string;
  localReady: boolean;
}

export async function getAppDevEnvironment(): Promise<AppDevEnvironment> {
  return hostApiFetch<AppDevEnvironment & { success: boolean }>('/api/app-dev/environment');
}

/** Background warmup — call when the creation entry becomes visible. */
export async function prepareAppDevEnvironment(): Promise<void> {
  await hostApiFetch('/api/app-dev/environment/prepare', { method: 'POST' });
}

export async function listDevApps(): Promise<DevAppSummary[]> {
  const res = await hostApiFetch<{ apps: DevAppSummary[] }>('/api/app-dev/apps');
  return res.apps ?? [];
}

export async function listDevAppWorkspaceIds(): Promise<string[]> {
  const res = await hostApiFetch<{ ids: string[] }>('/api/app-dev/apps/ids');
  return res.ids ?? [];
}

/** Re-apply app marker + AGENTS.md after project agent seed (context injection). */
export async function ensureAppDevContext(workspaceId: string): Promise<void> {
  await hostApiFetch('/api/app-dev/apps/context', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId }),
  });
}

export async function createUserApp(input: {
  name: string;
  parentDir?: string;
  projectType?: string;
}): Promise<{ workspaceId: string; appPath: string; workspaceName: string }> {
  return hostApiFetch('/api/app-dev/apps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function getAppStatus(workspaceId: string): Promise<AppDevStatus | null> {
  const res = await hostApiFetch<{ status: AppDevStatus | null }>(
    `/api/app-dev/apps/status?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
  return res.status;
}

export async function startApp(workspaceId: string): Promise<void> {
  await hostApiFetch('/api/app-dev/apps/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId }),
  });
}

export async function stopApp(workspaceId: string): Promise<void> {
  await hostApiFetch('/api/app-dev/apps/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId }),
  });
}

/** Read-and-clear compile/runtime errors (agent repair loop input). */
export async function drainAppErrors(workspaceId: string): Promise<string[]> {
  const res = await hostApiFetch<{ errors: string[] }>(
    `/api/app-dev/apps/errors?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
  return res.errors ?? [];
}

export async function listAppCheckpoints(workspaceId: string): Promise<AppCheckpoint[]> {
  const res = await hostApiFetch<{ checkpoints: AppCheckpoint[] }>(
    `/api/app-dev/checkpoints?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
  return res.checkpoints ?? [];
}

export async function createAppCheckpoint(workspaceId: string, message: string): Promise<boolean> {
  const res = await hostApiFetch<{ created: boolean }>('/api/app-dev/checkpoints', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId, message }),
  });
  return res.created === true;
}

export async function restoreAppCheckpoint(
  workspaceId: string,
  hash?: string,
): Promise<{ restored: boolean }> {
  return hostApiFetch('/api/app-dev/checkpoints/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId, hash }),
  });
}

export interface AppSourceFileEntry {
  path: string;
  size: number;
}

export async function listAppSourceFiles(workspaceId: string): Promise<AppSourceFileEntry[]> {
  const res = await hostApiFetch<{ files: AppSourceFileEntry[] }>(
    `/api/app-dev/files?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
  return res.files ?? [];
}

export async function readAppSourceFile(
  workspaceId: string,
  path: string,
): Promise<{ path: string; content: string }> {
  return hostApiFetch('/api/app-dev/files/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId, path }),
  });
}

export async function writeAppSourceFile(
  workspaceId: string,
  path: string,
  content: string,
): Promise<{ path: string; bytes: number }> {
  return hostApiFetch('/api/app-dev/files/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId, path, content }),
  });
}

export interface AppSourceSearchHit {
  path: string;
  line: number;
  column: number;
  preview: string;
}

export async function searchAppSourceFiles(
  workspaceId: string,
  query: string,
): Promise<AppSourceSearchHit[]> {
  const res = await hostApiFetch<{ hits: AppSourceSearchHit[] }>('/api/app-dev/files/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId, query }),
  });
  return res.hits ?? [];
}
