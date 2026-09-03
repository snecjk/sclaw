/**
 * Renderer API for user app development (OpenSpec change: app-dev-workbench-mvp).
 * All calls go through host-api — never direct IPC / Gateway.
 */
import { hostApiFetch, type HostApiFetchInit } from '@/lib/host-api';
import type { CodeApplicationPageType } from '../../shared/code-application-catalog';
import type {
  ExternalServiceBindingSnapshot,
  ExternalServicePageResult,
} from '../../shared/external-service-contract';
import type {
  TemplateImportApplyResult,
  TemplateImportPreview,
  TemplateImportStatus,
} from '../../shared/app-template-source-import';
import type { StoAppDeployHistoryRecord } from '../../shared/sto-app-deploy-history';
export type { CodeApplicationPageType } from '../../shared/code-application-catalog';
export type { StoAppDeployHistoryRecord } from '../../shared/sto-app-deploy-history';

/** sai-cli / 建站长耗时接口：不走 Host API 默认 15s 超时 */
const APP_DEV_LONG_RUNNING: Pick<HostApiFetchInit, 'disableTimeout'> = {
  disableTimeout: true,
};

export type NodeRuntimeState = 'ready' | 'not-installed' | 'downloading' | 'extracting' | 'error';

export interface NodeRuntimeStatus {
  state: NodeRuntimeState;
  version: string;
  receivedBytes: number;
  totalBytes: number;
  error?: string;
}

export type AppDevPhase =
  | 'created' | 'preparing-env' | 'checking-snpm' | 'installing' | 'starting' | 'ready' | 'stopped' | 'error';

export interface AppDevStatus {
  workspaceId: string;
  appPath: string;
  phase: AppDevPhase;
  progress: number;
  previewUrl?: string;
  error?: string;
  /** Extra line for the active setup step (e.g. snpm found vs installing). */
  detail?: string;
  /** Recent snpm / setup command output shown in the workbench log panel. */
  log?: string;
}

export interface AppDevEnvironment {
  nodeRuntime: NodeRuntimeStatus;
  gitAvailable: boolean;
  defaultParentDir: string;
}

export interface AppTemplateSummary {
  templateId: string;
  pageType: CodeApplicationPageType;
  name: string;
  description: string;
  status: 'ACTIVE' | 'DISABLED';
  isBuiltin: boolean;
  latestVersion: string;
  createdAt: string;
  updatedAt: string;
  source?: 'local-resource' | 'memory-center';
}

export interface AppTemplatePageResult {
  items: AppTemplateSummary[];
  total: number;
  pageNum: number;
  pageSize: number;
}

export interface BuiltinTemplateDebugStatus {
  isBuiltinDebug: boolean;
  templateId?: 'site-minimal' | 'assets-minimal';
  pageType?: CodeApplicationPageType;
  sourceChanged: boolean;
  changes: Array<{ path: string; kind: 'add' | 'modify' | 'delete' }>;
}

export interface AppCheckpoint {
  hash: string;
  subject: string;
  timestamp: number;
}

export interface AppExternalServiceChangeResult {
  changedFiles: string[];
  installedPackage?: string | null;
  usageGuide?: string | null;
  binding?: ExternalServiceBindingSnapshot;
}

export async function searchAppExternalServices(
  workspaceId: string,
  keyword = '',
): Promise<ExternalServicePageResult> {
  const query = new URLSearchParams({ workspaceId, keyword });
  return hostApiFetch(`/api/app-external-services/search?${query.toString()}`);
}

export async function listAppExternalServiceBindings(
  workspaceId: string,
): Promise<ExternalServiceBindingSnapshot[]> {
  const response = await hostApiFetch<{ bindings: ExternalServiceBindingSnapshot[] }>(
    `/api/app-external-services/bindings?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
  return response.bindings ?? [];
}

export async function bindAppExternalService(input: {
  workspaceId: string;
  serviceId: string;
  version: string;
  alias: string;
}): Promise<AppExternalServiceChangeResult> {
  return hostApiFetch('/api/app-external-services/bind', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    ...APP_DEV_LONG_RUNNING,
  });
}

export async function upgradeAppExternalService(input: {
  workspaceId: string;
  alias: string;
  version: string;
}): Promise<AppExternalServiceChangeResult> {
  return hostApiFetch('/api/app-external-services/upgrade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    ...APP_DEV_LONG_RUNNING,
  });
}

export async function removeAppExternalService(input: {
  workspaceId: string;
  alias: string;
}): Promise<AppExternalServiceChangeResult> {
  return hostApiFetch('/api/app-external-services/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export interface DevAppSummary {
  workspaceId: string;
  name: string;
  appPath: string;
  projectType: string;
  createdAt: string;
  localReady: boolean;
  appCode?: string;
  availability?: 'local' | 'remote-only' | 'path-missing';
  previewUrl?: string;
  permissionsUrl?: string;
  gitlabProjectId?: string;
  devopsApplicationId?: string;
  /** `imported` = 本地导入；`created` = 新建站 / 云端拉取 */
  source?: 'created' | 'imported';
  /** Whether the app folder already has a `.git` directory. */
  gitRepo?: boolean;
  pageType: CodeApplicationPageType;
}

export async function getAppDevEnvironment(): Promise<AppDevEnvironment> {
  return hostApiFetch<AppDevEnvironment & { success: boolean }>('/api/app-dev/environment');
}

/** Background warmup — call when the creation entry becomes visible. */
export async function prepareAppDevEnvironment(): Promise<void> {
  await hostApiFetch('/api/app-dev/environment/prepare', { method: 'POST' });
}

export async function listAppTemplates(
  pageType?: CodeApplicationPageType,
): Promise<AppTemplatePageResult> {
  const query = pageType ? `?pageType=${encodeURIComponent(pageType)}` : '';
  return hostApiFetch(`/api/app-templates${query}`);
}

export async function openAppTemplateWorkspace(input: {
  templateId?: string;
  pageType: CodeApplicationPageType;
  name: string;
  description?: string;
  latestVersion?: string;
  source?: 'local-resource' | 'memory-center';
}): Promise<{ workspaceId: string; appPath: string; workspaceName: string; templateId: string }> {
  return hostApiFetch('/api/app-templates/workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    ...APP_DEV_LONG_RUNNING,
  });
}

export async function publishAppTemplateWorkspace(
  workspaceId: string,
): Promise<{
  templateId: string;
  pageType: CodeApplicationPageType;
  version: string;
  status: 'ACTIVE';
  packageOssKey: string;
  packageEtag: string | null;
  packageSize: number;
  created: boolean;
}> {
  return hostApiFetch('/api/app-templates/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId, confirmed: true }),
    ...APP_DEV_LONG_RUNNING,
  });
}

export async function getBuiltinTemplateDebugStatus(
  workspaceId: string,
): Promise<BuiltinTemplateDebugStatus> {
  return hostApiFetch(
    `/api/app-templates/workspaces/builtin-debug/status?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
}

export async function syncBuiltinTemplateDebugWorkspace(
  workspaceId: string,
): Promise<{ changedFiles: string[] }> {
  return hostApiFetch('/api/app-templates/workspaces/builtin-debug/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId, confirmed: true }),
    ...APP_DEV_LONG_RUNNING,
  });
}

export async function resetBuiltinTemplateDebugWorkspace(
  workspaceId: string,
): Promise<{ changedFiles: string[] }> {
  return hostApiFetch('/api/app-templates/workspaces/builtin-debug/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId, confirmed: true }),
    ...APP_DEV_LONG_RUNNING,
  });
}

export async function getAppTemplateImportStatus(
  workspaceId: string,
): Promise<TemplateImportStatus> {
  return hostApiFetch(
    `/api/app-templates/workspaces/import-source/status?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
}

export async function prepareAppTemplateImport(input: {
  workspaceId: string;
  sourcePath?: string;
}): Promise<TemplateImportPreview> {
  return hostApiFetch('/api/app-templates/workspaces/import-source/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    ...APP_DEV_LONG_RUNNING,
  });
}

export async function applyAppTemplateImport(input: {
  workspaceId: string;
  importToken: string;
}): Promise<TemplateImportApplyResult> {
  return hostApiFetch('/api/app-templates/workspaces/import-source/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    ...APP_DEV_LONG_RUNNING,
  });
}

export async function cancelAppTemplateImport(input: {
  workspaceId: string;
  importToken: string;
}): Promise<{ cancelled: boolean }> {
  return hostApiFetch('/api/app-templates/workspaces/import-source/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function listDevApps(): Promise<DevAppSummary[]> {
  const res = await hostApiFetch<{ apps: DevAppSummary[] }>('/api/app-dev/apps');
  return res.apps ?? [];
}

export async function cloneDevApp(input: {
  appCode: string;
  applicationName?: string;
  parentDir: string;
}): Promise<{ workspaceId: string; appPath: string; workspaceName: string; appCode: string }> {
  return hostApiFetch('/api/app-dev/apps/clone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    ...APP_DEV_LONG_RUNNING,
  });
}

export async function deleteDevApp(input: {
  appCode?: string;
  workspaceId?: string;
  deleteLocal?: boolean;
}): Promise<{ offline: boolean; deletedLocal: boolean; deletedFiles: boolean; appPath: string }> {
  return hostApiFetch('/api/app-dev/apps/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appCode: input.appCode,
      workspaceId: input.workspaceId,
      deleteLocal: input.deleteLocal === true,
    }),
    ...APP_DEV_LONG_RUNNING,
  });
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
  pageType?: CodeApplicationPageType;
  templateId: string;
  templateVersion: string;
  templateSource?: 'local-resource' | 'memory-center';
}): Promise<{ workspaceId: string; appPath: string; workspaceName: string }> {
  return hostApiFetch('/api/app-dev/apps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    ...APP_DEV_LONG_RUNNING,
  });
}

export async function importUserApp(input: {
  appPath: string;
  name?: string;
}): Promise<{ workspaceId: string; appPath: string; workspaceName: string }> {
  return hostApiFetch('/api/app-dev/apps/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    ...APP_DEV_LONG_RUNNING,
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

export async function restartApp(workspaceId: string): Promise<void> {
  await hostApiFetch('/api/app-dev/apps/restart', {
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

/** 预览路由下拉条目（T03）：`#/home` / `/home` / `#home` 路径片段 + 展示名。 */
export interface AppRouteEntry {
  path: string;
  label: string;
  source: 'router' | 'a2ui';
}

export async function listAppRoutes(workspaceId: string): Promise<AppRouteEntry[]> {
  const res = await hostApiFetch<{ routes: AppRouteEntry[] }>(
    `/api/app-dev/routes?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
  return res.routes ?? [];
}

export async function installAppNpmPackage(
  workspaceId: string,
  packageName: string,
  packageId?: string,
): Promise<{
  packageName: string;
  output: string;
  packageId?: string;
  ai?: { skillId?: string; skillPath?: string; mode: 'full' | 'deps-only' };
}> {
  return hostApiFetch('/api/app-dev/packages/npm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId, packageName, packageId }),
  });
}

export async function installAppPipPackage(
  workspaceId: string,
  packageName: string,
  packageId?: string,
): Promise<{
  packageName: string;
  output: string;
  packageId?: string;
  ai?: { skillId?: string; skillPath?: string; mode: 'full' | 'deps-only' };
}> {
  return hostApiFetch('/api/app-dev/packages/pip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId, packageName, packageId }),
  });
}

export interface AppDevPackageCatalogItem {
  id: string;
  kind: 'frontend' | 'backend';
  name: string;
  packageName: string;
  description: string;
  npmPackages?: string[];
  ai?: { skillId?: string; summary?: string };
}

export async function listAppDevPackageCatalog(
  workspaceId: string,
): Promise<AppDevPackageCatalogItem[]> {
  const res = await hostApiFetch<{ packages: AppDevPackageCatalogItem[] }>(
    `/api/app-dev/packages?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
  return res.packages ?? [];
}

export interface AppDevAssistSkill {
  id: string;
  name: string;
  description: string;
  installed: boolean;
}

export async function listAppDevAssistSkills(
  workspaceId: string,
): Promise<AppDevAssistSkill[]> {
  const res = await hostApiFetch<{ skills: AppDevAssistSkill[] }>(
    `/api/app-dev/dev-skills?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
  return res.skills ?? [];
}

export async function installAppDevAssistSkill(
  workspaceId: string,
  skillId: string,
): Promise<{ skillId: string; targetPath: string }> {
  return hostApiFetch('/api/app-dev/dev-skills/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId, skillId }),
  });
}

export interface StoAppStatus {
  available: boolean;
  executable: string | null;
  bound: boolean;
  syncState: 'unbound' | 'synced' | 'local-changes' | 'remote-ahead' | 'merge-required' | 'unknown';
  syncLabel: string;
  appCode?: string;
  applicationName?: string;
  revisionId?: string;
  devCommitSha?: string;
  raw?: unknown;
}

export async function getStoAppStatus(workspaceId: string): Promise<StoAppStatus> {
  const res = await hostApiFetch<{ status: StoAppStatus }>(
    `/api/app-dev/sto-app/status?workspaceId=${encodeURIComponent(workspaceId)}`,
    APP_DEV_LONG_RUNNING,
  );
  return res.status;
}

export interface StoAppPushHistoryItem {
  revisionId: string;
  appCode: string;
  message: string;
  commitSha?: string;
  createdAt: number;
}

export async function listStoAppPushes(workspaceId: string): Promise<StoAppPushHistoryItem[]> {
  const res = await hostApiFetch<{ items: StoAppPushHistoryItem[] }>(
    `/api/app-dev/sto-app/pushes?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
  return res.items ?? [];
}

export async function pushStoApp(
  workspaceId: string,
  message: string,
): Promise<{ ok: boolean; output: string; json?: unknown }> {
  return hostApiFetch('/api/app-dev/sto-app/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId, message }),
    ...APP_DEV_LONG_RUNNING,
  });
}

export async function pullStoApp(
  workspaceId: string,
): Promise<{ ok: boolean; output: string; json?: unknown }> {
  return hostApiFetch('/api/app-dev/sto-app/pull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId }),
    ...APP_DEV_LONG_RUNNING,
  });
}

export async function continueStoAppMerge(
  workspaceId: string,
  revisionId: string,
): Promise<{ ok: boolean; output: string; json?: unknown }> {
  return hostApiFetch('/api/app-dev/sto-app/merge-continue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId, revisionId }),
    ...APP_DEV_LONG_RUNNING,
  });
}

export type CodeDeployEnv = 'daily' | 'stage' | 'online';

export async function deployStoApp(input: {
  workspaceId: string;
  env: CodeDeployEnv;
  appCode?: string;
  requestId?: string;
  deploymentVersion?: string;
  /** Commit message used by sto-app push before create. */
  pushMessage?: string;
}): Promise<{
  success: boolean;
  appCode: string;
  env: CodeDeployEnv;
  pushed?: boolean;
  data: unknown;
}> {
  return hostApiFetch('/api/app-dev/sto-app/deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    ...APP_DEV_LONG_RUNNING,
  });
}

export async function refreshStoAppDeploy(input: {
  deploymentId: string;
  workspaceId?: string;
  appCode?: string;
}): Promise<{
  success: boolean;
  deploymentId: string;
  data: unknown;
}> {
  return hostApiFetch('/api/app-dev/sto-app/deploy/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    ...APP_DEV_LONG_RUNNING,
  });
}

export async function listStoAppDeployHistory(workspaceId: string): Promise<StoAppDeployHistoryRecord[]> {
  const res = await hostApiFetch<{ items?: StoAppDeployHistoryRecord[] }>(
    `/api/app-dev/sto-app/deploy/history?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
  return Array.isArray(res.items) ? res.items : [];
}

export async function upsertStoAppDeployHistory(
  workspaceId: string,
  record: StoAppDeployHistoryRecord,
): Promise<StoAppDeployHistoryRecord[]> {
  const res = await hostApiFetch<{ items?: StoAppDeployHistoryRecord[] }>(
    '/api/app-dev/sto-app/deploy/history',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId, record }),
    },
  );
  return Array.isArray(res.items) ? res.items : [];
}

export interface SiteappMenuPreviewItem {
  menu_code: string;
  parent_code: string | null;
  menu_name: string;
  menu_type: string;
  resource_path?: string | null;
}

export interface SiteappMenuPreview {
  appCode?: string;
  menus: SiteappMenuPreviewItem[];
  skipped: Array<{ label: string; reason: string; path?: string }>;
  source: 'top-nav' | 'side-nav' | 'routes' | 'mixed' | 'empty';
}

export async function previewStoAppMenus(input: {
  workspaceId: string;
  pageType?: string;
  appName?: string;
}): Promise<SiteappMenuPreview> {
  return hostApiFetch('/api/app-dev/sto-app/menu/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function syncStoAppMenus(input: {
  workspaceId: string;
  appCode?: string;
  menus: SiteappMenuPreviewItem[];
}): Promise<{ success: boolean; appCode: string; data: unknown }> {
  return hostApiFetch('/api/app-dev/sto-app/menu/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    ...APP_DEV_LONG_RUNNING,
  });
}
