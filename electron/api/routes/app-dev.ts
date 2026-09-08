/**
 * Host API routes for user app development (OpenSpec change: app-dev-workbench-mvp).
 * Local business logic (scaffold, managed runtime, dev server, checkpoints) —
 * allowed as a dedicated handler per the server.ts routing policy.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { getNodeRuntimeStatus, setupManagedNode } from '../../utils/node-runtime';
import {
  DEFAULT_APPS_PARENT_DIR,
  createCheckpointDetailed,
  createUserApp,
  cloneDevApp,
  diffCheckpoint,
  importUserApp,
  ensureAppDevContext,
  getAppDevStatus,
  isGitAvailable,
  listAppRoutes,
  listAppSourceFiles,
  listAppArtifacts,
  listAppGeneratedAssets,
  exportAppGeneratedAsset,
  listCheckpoints,
  listDevAppWorkspaceIds,
  listDevApps,
  resolveCloudAppForWorkspace,
  readAppSourceFile,
  readAppDesignTokens,
  applyAppThemeOverrides,
  captureAppPreviewByWebContentsId,
  putAppArtifacts,
  restartApp,
  restoreCheckpoint,
  runSetupPipeline,
  searchAppSourceFiles,
  stopApp,
  writeAppSourceFile,
  type AppDevArtifactRecord,
  installNpmPackage,
  installPipPackage,
  listAppDevAssistSkills,
  installAppDevAssistSkill,
  listAppDevPackageCatalog,
  deleteDevApp,
  type CreateUserAppInput,
  isFullstackAppMarker,
  readAppDevMarker,
} from '../../services/app-dev-service';
import { getDevServerLogs, drainDevServerErrors } from '../../services/app-dev-server-manager';
import {
  getRuntimeLogs,
  getRuntimeStatus,
  migrateAppDatabase,
  restartRuntime,
  startRuntime,
  stopRuntime,
  drainBackendErrors,
  consumeBackendEscalate,
  buildBackendRepairPrompt,
  restartBackendOnly,
  runAppSmoke,
} from '../../services/app-runtime-manager';
import {
  deleteAppDevSecret,
  listAppDevSecretKeys,
  setAppDevSecret,
} from '../../services/app-dev-secrets';
import { getWorkspaceRootPath } from '../../services/session-catalog-service';
import { logger } from '../../utils/logger';
import {
  continueStoAppMerge,
  getStoAppStatus,
  pullStoApp,
  pushStoApp,
} from '../../services/sto-app-service';
import { getStoAppBindingByWorkspaceId } from '../../services/sto-app-binding-store';
import { readStoAppPushHistory } from '../../services/sto-app-push-history-store';
import { ensureStoWorkspaceBinding } from '../../services/code-collab-service';
import { handleAppDevSsoAuthRoute } from './app-dev-sso-auth';
import { assertExternalServicesReadyForDeploy } from '../../services/app-dev-deploy-preflight';
import { ensureSiteAppActiveForDeploy, createSiteAppDeploy, refreshSiteAppDeploy, syncSiteAppMenus } from '../../services/site-app-api';
import { resolveSiteappDeployCreateParams } from '../../utils/siteapp-cli';
import { StoMemoryApiError } from '../../services/sto-memory-api-fetch';
import {
  extractDeploymentIdFromText,
  formatCodeDeployImmediateFailureMessage,
  isCodeDeployFailed,
  isSpuriousPendingDeployFailure,
  pickCodeDeployFields,
} from '../../../shared/code-deploy-status';

const APP_DEV_LOG_MAX_CHARS = 12_000;

function serializeForAppDevLog(value: unknown, maxChars = APP_DEV_LOG_MAX_CHARS): string {
  try {
    const text = JSON.stringify(value);
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}…[truncated ${text.length - maxChars} chars]`;
  } catch {
    return '[unserializable]';
  }
}

function summarizeDeployCloud(cloud: {
  appCode?: string;
  applicationName?: string;
  status?: string;
  gitlabProjectId?: string;
  devopsApplicationId?: string;
  headRevisionId?: string;
  headCommitSha?: string;
  previewUrl?: string;
} | null): Record<string, unknown> | null {
  if (!cloud) return null;
  return {
    appCode: cloud.appCode,
    applicationName: cloud.applicationName,
    status: cloud.status,
    gitlabProjectId: cloud.gitlabProjectId,
    devopsApplicationId: cloud.devopsApplicationId,
    headRevisionId: cloud.headRevisionId,
    headCommitSha: cloud.headCommitSha,
    previewUrl: cloud.previewUrl,
  };
}

function isDeploymentBusyMessage(message: string): boolean {
  return /DEPLOYMENT_BUSY|已有发布正在执行/.test(message);
}

function buildBusyDeployReuseData(
  deploymentId: string,
  deployParams: Record<string, string>,
): Record<string, unknown> {
  return {
    deployment_id: deploymentId,
    app_code: deployParams.app_code,
    env: deployParams.env,
    deployment_version: deployParams.deployment_version,
    request_id: deployParams.request_id,
    status: 'BUILDING',
  };
}

function siteAppHttpErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof StoMemoryApiError && error.message.trim()) return error.message.trim();
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return fallback;
}

function resolveDeployCreatePayload(
  json: unknown,
  deployParams: Record<string, string>,
  error?: unknown,
): { data: unknown } | { error: string } {
  if (error) {
    const message = siteAppHttpErrorMessage(error, '发布失败');
    const busyDeploymentId = extractDeploymentIdFromText(message);
    if (busyDeploymentId && isDeploymentBusyMessage(message)) {
      logger.info(
        `[app-dev] deploy:reuse-busy deploymentId=${busyDeploymentId} message=${message}`,
      );
      return { data: buildBusyDeployReuseData(busyDeploymentId, deployParams) };
    }
    return { error: message };
  }

  const fields = pickCodeDeployFields(json);
  if (isSpuriousPendingDeployFailure(fields)) {
    logger.warn(
      `[app-dev] deploy:create-pending-misreport ${serializeForAppDevLog({
        status: fields.status,
        failureMessage: fields.failureMessage,
        failureStage: fields.failureStage,
        deploymentId: fields.deploymentId,
      })}`,
    );
    return { data: json };
  }
  if (isCodeDeployFailed(fields.status)) {
    return { error: formatCodeDeployImmediateFailureMessage(fields) };
  }
  return { data: json };
}

async function resolveAppPath(workspaceId: string): Promise<string> {
  const rootPath = await getWorkspaceRootPath(workspaceId);
  if (!rootPath) throw new Error(`Workspace not found: ${workspaceId}`);
  return rootPath;
}

export async function handleAppDevRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/app-dev/')) return false;

  try {
    if (await handleAppDevSsoAuthRoute(req, res, url)) return true;

    // --- Managed Node runtime (capability: service-node-runtime) ---
    if (url.pathname === '/api/app-dev/environment' && req.method === 'GET') {
      sendJson(res, 200, {
        success: true,
        nodeRuntime: getNodeRuntimeStatus(),
        gitAvailable: await isGitAvailable(),
        defaultParentDir: DEFAULT_APPS_PARENT_DIR,
      });
      return true;
    }

    // Fire-and-forget warmup: called when the user opens the creation entry so
    // the runtime is usually ready before the wizard is submitted.
    if (url.pathname === '/api/app-dev/environment/prepare' && req.method === 'POST') {
      void setupManagedNode().catch((err) => logger.warn('[app-dev] node warmup failed:', err));
      sendJson(res, 200, { success: true, nodeRuntime: getNodeRuntimeStatus() });
      return true;
    }

    // --- App creation / listing (capability: app-create-scaffold) ---
    if (url.pathname === '/api/app-dev/apps' && req.method === 'GET') {
      logger.info('[app-dev] GET /api/app-dev/apps');
      const apps = await listDevApps();
      logger.info(`[app-dev] GET /api/app-dev/apps count=${apps.length}`);
      sendJson(res, 200, { success: true, apps });
      return true;
    }

    if (url.pathname === '/api/app-dev/apps/ids' && req.method === 'GET') {
      const ids = await listDevAppWorkspaceIds();
      sendJson(res, 200, { success: true, ids });
      return true;
    }

    if (url.pathname === '/api/app-dev/apps' && req.method === 'POST') {
      const body = await parseJsonBody<CreateUserAppInput>(req);
      const result = await createUserApp(body);
      sendJson(res, 200, { success: true, ...result });
      return true;
    }

    if (url.pathname === '/api/app-dev/apps/clone' && req.method === 'POST') {
      const body = await parseJsonBody<{
        appCode?: string;
        applicationName?: string;
        parentDir?: string;
      }>(req);
      const result = await cloneDevApp({
        appCode: body.appCode ?? '',
        applicationName: body.applicationName,
        parentDir: body.parentDir ?? '',
      });
      sendJson(res, 200, { success: true, ...result });
      return true;
    }

    if (url.pathname === '/api/app-dev/apps/import' && req.method === 'POST') {
      const body = await parseJsonBody<{ appPath: string; name?: string }>(req);
      const result = await importUserApp({
        appPath: body.appPath ?? '',
        name: body.name,
      });
      sendJson(res, 200, { success: true, ...result });
      return true;
    }

    if (url.pathname === '/api/app-dev/apps/delete' && req.method === 'POST') {
      const body = await parseJsonBody<{
        appCode?: string;
        workspaceId?: string;
        deleteLocal?: boolean;
      }>(req);
      const result = await deleteDevApp(
        {
          appCode: body.appCode,
          workspaceId: body.workspaceId,
          deleteLocal: body.deleteLocal === true,
        },
        ctx.gatewayManager,
      );
      sendJson(res, 200, { success: true, ...result });
      return true;
    }

    if (url.pathname === '/api/app-dev/apps/context' && req.method === 'POST') {
      const body = await parseJsonBody<{ workspaceId: string }>(req);
      await ensureAppDevContext(body.workspaceId);
      sendJson(res, 200, { success: true });
      return true;
    }

    // --- Pipeline / dev server (capability: service-dev-server) ---
    if (url.pathname === '/api/app-dev/apps/status' && req.method === 'GET') {
      const workspaceId = url.searchParams.get('workspaceId') ?? '';
      sendJson(res, 200, { success: true, status: getAppDevStatus(workspaceId) });
      return true;
    }

    if (url.pathname === '/api/app-dev/apps/start' && req.method === 'POST') {
      const body = await parseJsonBody<{ workspaceId: string }>(req);
      const appPath = await resolveAppPath(body.workspaceId);
      void runSetupPipeline(body.workspaceId, appPath).catch(() => undefined);
      sendJson(res, 200, { success: true });
      return true;
    }

    if (url.pathname === '/api/app-dev/apps/stop' && req.method === 'POST') {
      const body = await parseJsonBody<{ workspaceId: string }>(req);
      stopApp(body.workspaceId);
      sendJson(res, 200, { success: true });
      return true;
    }

    if (url.pathname === '/api/app-dev/apps/restart' && req.method === 'POST') {
      const body = await parseJsonBody<{ workspaceId: string }>(req);
      const appPath = await resolveAppPath(body.workspaceId);
      void restartApp(body.workspaceId, appPath).catch(() => undefined);
      sendJson(res, 200, { success: true });
      return true;
    }

    if (url.pathname === '/api/app-dev/apps/logs' && req.method === 'GET') {
      const workspaceId = url.searchParams.get('workspaceId') ?? '';
      sendJson(res, 200, { success: true, logs: getDevServerLogs(workspaceId) });
      return true;
    }

    // Drained by the workbench to feed compile/runtime errors to the agent.
    if (url.pathname === '/api/app-dev/apps/errors' && req.method === 'GET') {
      const workspaceId = url.searchParams.get('workspaceId') ?? '';
      const frontend = drainDevServerErrors(workspaceId);
      const backend = drainBackendErrors(workspaceId);
      sendJson(res, 200, {
        success: true,
        errors: [...frontend, ...backend],
      });
      return true;
    }

    // --- Fullstack runtime / secrets ---
    if (url.pathname === '/api/app-dev/runtime/status' && req.method === 'GET') {
      const workspaceId = url.searchParams.get('workspaceId') ?? '';
      const appPath = await resolveAppPath(workspaceId);
      const marker = await readAppDevMarker(appPath);
      sendJson(res, 200, {
        success: true,
        fullstack: isFullstackAppMarker(marker),
        status: getRuntimeStatus(workspaceId, appPath),
        appStatus: getAppDevStatus(workspaceId),
      });
      return true;
    }

    if (url.pathname === '/api/app-dev/runtime/start' && req.method === 'POST') {
      const body = await parseJsonBody<{ workspaceId: string }>(req);
      const appPath = await resolveAppPath(body.workspaceId);
      const status = await startRuntime(body.workspaceId, appPath);
      sendJson(res, 200, { success: true, status });
      return true;
    }

    if (url.pathname === '/api/app-dev/runtime/stop' && req.method === 'POST') {
      const body = await parseJsonBody<{ workspaceId: string }>(req);
      stopRuntime(body.workspaceId);
      sendJson(res, 200, { success: true });
      return true;
    }

    if (url.pathname === '/api/app-dev/runtime/restart' && req.method === 'POST') {
      const body = await parseJsonBody<{ workspaceId: string }>(req);
      const appPath = await resolveAppPath(body.workspaceId);
      const status = await restartRuntime(body.workspaceId, appPath);
      sendJson(res, 200, { success: true, status });
      return true;
    }

    if (url.pathname === '/api/app-dev/runtime/restart-backend' && req.method === 'POST') {
      const body = await parseJsonBody<{ workspaceId: string }>(req);
      const appPath = await resolveAppPath(body.workspaceId);
      const status = await restartBackendOnly(body.workspaceId, appPath);
      sendJson(res, 200, { success: true, status });
      return true;
    }

    if (url.pathname === '/api/app-dev/runtime/escalate' && req.method === 'POST') {
      const body = await parseJsonBody<{ workspaceId: string }>(req);
      const escalate = consumeBackendEscalate(body.workspaceId);
      if (!escalate) {
        sendJson(res, 200, { success: true, escalate: null });
        return true;
      }
      sendJson(res, 200, {
        success: true,
        escalate: {
          fingerprint: escalate.fingerprint,
          attempt: escalate.attempt,
          melted: escalate.melted,
          prompt: escalate.melted ? null : buildBackendRepairPrompt(escalate.lines),
          lines: escalate.lines,
        },
      });
      return true;
    }

    if (url.pathname === '/api/app-dev/runtime/smoke' && req.method === 'POST') {
      const body = await parseJsonBody<{ workspaceId: string }>(req);
      const appPath = await resolveAppPath(body.workspaceId);
      const status = getRuntimeStatus(body.workspaceId, appPath);
      if (!status.backendUrl) {
        sendJson(res, 400, { success: false, errMessage: '后端未运行' });
        return true;
      }
      try {
        const output = await runAppSmoke(appPath, status.backendUrl);
        sendJson(res, 200, { success: true, output });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sendJson(res, 200, {
          success: false,
          errMessage: message,
          prompt: buildBackendRepairPrompt(message.split('\n').slice(-30)),
        });
      }
      return true;
    }

    if (url.pathname === '/api/app-dev/runtime/logs' && req.method === 'GET') {
      const workspaceId = url.searchParams.get('workspaceId') ?? '';
      const source = (url.searchParams.get('source') as 'frontend' | 'backend' | 'all' | null) ?? 'all';
      sendJson(res, 200, { success: true, logs: getRuntimeLogs(workspaceId, source) });
      return true;
    }

    if (url.pathname === '/api/app-dev/db/migrate' && req.method === 'POST') {
      const body = await parseJsonBody<{ workspaceId: string }>(req);
      const appPath = await resolveAppPath(body.workspaceId);
      await migrateAppDatabase(body.workspaceId, appPath);
      sendJson(res, 200, { success: true });
      return true;
    }

    if (url.pathname === '/api/app-dev/secrets' && req.method === 'GET') {
      const workspaceId = url.searchParams.get('workspaceId') ?? '';
      sendJson(res, 200, { success: true, keys: await listAppDevSecretKeys(workspaceId) });
      return true;
    }

    if (url.pathname === '/api/app-dev/secrets' && req.method === 'POST') {
      const body = await parseJsonBody<{ workspaceId: string; key: string; value: string }>(req);
      await setAppDevSecret(body.workspaceId, body.key, body.value);
      sendJson(res, 200, { success: true });
      return true;
    }

    if (url.pathname === '/api/app-dev/secrets' && req.method === 'DELETE') {
      const body = await parseJsonBody<{ workspaceId: string; key: string }>(req);
      await deleteAppDevSecret(body.workspaceId, body.key);
      sendJson(res, 200, { success: true });
      return true;
    }

    // --- Checkpoints (capability: service-git-checkpoint) ---
    if (url.pathname === '/api/app-dev/checkpoints' && req.method === 'GET') {
      const workspaceId = url.searchParams.get('workspaceId') ?? '';
      const appPath = await resolveAppPath(workspaceId);
      sendJson(res, 200, { success: true, checkpoints: await listCheckpoints(appPath) });
      return true;
    }

    if (url.pathname === '/api/app-dev/checkpoints' && req.method === 'POST') {
      const body = await parseJsonBody<{ workspaceId: string; message?: string }>(req);
      const appPath = await resolveAppPath(body.workspaceId);
      const subject = body.message ?? '应用更新';
      // T04：响应只增字段（status/hash/subject），旧调用方按 created 判定不受影响。
      const result = await createCheckpointDetailed(appPath, subject);
      sendJson(res, 200, {
        success: true,
        created: result.status === 'created',
        status: result.status,
        hash: result.hash,
        subject,
      });
      return true;
    }

    // T04 / T10：checkpoint diff；可选 baseHash 做任意两版对比。
    if (url.pathname === '/api/app-dev/checkpoints/diff' && req.method === 'GET') {
      const workspaceId = url.searchParams.get('workspaceId') ?? '';
      const hash = url.searchParams.get('hash') ?? '';
      const baseHash = url.searchParams.get('baseHash') ?? undefined;
      const appPath = await resolveAppPath(workspaceId);
      const diff = await diffCheckpoint(appPath, hash, baseHash || undefined);
      if (!diff) {
        sendJson(res, 200, { success: false, error: '无法读取该版本的差异' });
        return true;
      }
      sendJson(res, 200, { success: true, diff });
      return true;
    }

    if (url.pathname === '/api/app-dev/checkpoints/restore' && req.method === 'POST') {
      const body = await parseJsonBody<{ workspaceId: string; hash?: string }>(req);
      const appPath = await resolveAppPath(body.workspaceId);
      const result = await restoreCheckpoint(appPath, body.hash);
      sendJson(res, 200, { success: result.restored, ...result });
      return true;
    }

    // --- Source files for Monaco workbench ---
    if (url.pathname === '/api/app-dev/files' && req.method === 'GET') {
      const workspaceId = url.searchParams.get('workspaceId') ?? '';
      const appPath = await resolveAppPath(workspaceId);
      const files = await listAppSourceFiles(appPath);
      sendJson(res, 200, { success: true, files });
      return true;
    }

    if (url.pathname === '/api/app-dev/files/read' && req.method === 'POST') {
      const body = await parseJsonBody<{ workspaceId: string; path: string }>(req);
      const appPath = await resolveAppPath(body.workspaceId);
      const file = await readAppSourceFile(appPath, body.path ?? '');
      sendJson(res, 200, { success: true, ...file });
      return true;
    }

    if (url.pathname === '/api/app-dev/files/write' && req.method === 'POST') {
      const body = await parseJsonBody<{ workspaceId: string; path: string; content: string }>(req);
      const appPath = await resolveAppPath(body.workspaceId);
      const result = await writeAppSourceFile(appPath, body.path ?? '', body.content ?? '');
      sendJson(res, 200, { success: true, ...result });
      return true;
    }

    if (url.pathname === '/api/app-dev/files/search' && req.method === 'POST') {
      const body = await parseJsonBody<{ workspaceId: string; query: string }>(req);
      const appPath = await resolveAppPath(body.workspaceId);
      const hits = await searchAppSourceFiles(appPath, body.query ?? '');
      sendJson(res, 200, { success: true, hits });
      return true;
    }

    // 预览路由下拉（T03）：扫描应用路由声明 / A2UI 页面资产。
    if (url.pathname === '/api/app-dev/routes' && req.method === 'GET') {
      const workspaceId = url.searchParams.get('workspaceId') ?? '';
      const appPath = await resolveAppPath(workspaceId);
      sendJson(res, 200, { success: true, routes: await listAppRoutes(appPath) });
      return true;
    }

    // 设计 token 契约（T06/T08）：旧模板无契约时 degraded=true + 内置默认项。
    if (url.pathname === '/api/app-dev/theme/tokens' && req.method === 'GET') {
      const workspaceId = url.searchParams.get('workspaceId') ?? '';
      const appPath = await resolveAppPath(workspaceId);
      sendJson(res, 200, { success: true, ...(await readAppDesignTokens(appPath)) });
      return true;
    }

    // 主题落盘（T06）：行级替换 theme.css 变量值。
    if (url.pathname === '/api/app-dev/theme' && req.method === 'PUT') {
      const body = await parseJsonBody<{
        workspaceId?: string;
        overrides?: Record<string, string>;
      }>(req);
      const workspaceId = (body.workspaceId ?? '').trim();
      if (!workspaceId) throw new Error('缺少 workspaceId');
      const overrides = body.overrides && typeof body.overrides === 'object' ? body.overrides : {};
      const appPath = await resolveAppPath(workspaceId);
      const result = await applyAppThemeOverrides(appPath, overrides);
      sendJson(res, 200, { success: true, ...result });
      return true;
    }

    // 产物卡持久化（T09）
    if (url.pathname === '/api/app-dev/artifacts' && req.method === 'GET') {
      const workspaceId = url.searchParams.get('workspaceId') ?? '';
      const appPath = await resolveAppPath(workspaceId);
      sendJson(res, 200, { success: true, items: await listAppArtifacts(appPath) });
      return true;
    }

    if (url.pathname === '/api/app-dev/artifacts' && req.method === 'PUT') {
      const body = await parseJsonBody<{
        workspaceId?: string;
        items?: AppDevArtifactRecord[];
      }>(req);
      const workspaceId = (body.workspaceId ?? '').trim();
      if (!workspaceId) throw new Error('缺少 workspaceId');
      const appPath = await resolveAppPath(workspaceId);
      const items = await putAppArtifacts(appPath, Array.isArray(body.items) ? body.items : []);
      sendJson(res, 200, { success: true, items });
      return true;
    }

    // 预览截图（T09）：webContentsId → JPEG dataURL
    if (url.pathname === '/api/app-dev/preview/capture' && req.method === 'POST') {
      const body = await parseJsonBody<{ workspaceId?: string; webContentsId?: number }>(req);
      const webContentsId = Number(body.webContentsId);
      if (!Number.isInteger(webContentsId) || webContentsId <= 0) {
        throw Object.assign(new Error('缺少有效的 webContentsId'), { statusCode: 400 });
      }
      // workspaceId 仅用于鉴权路径存在（防止任意 id 滥调）；真正截图按 webContentsId。
      if (body.workspaceId) await resolveAppPath(body.workspaceId);
      const shot = await captureAppPreviewByWebContentsId(webContentsId);
      sendJson(res, 200, { success: true, ...shot });
      return true;
    }

    // 生成资产列表（T14）
    if (url.pathname === '/api/app-dev/generated-assets' && req.method === 'GET') {
      const workspaceId = url.searchParams.get('workspaceId') ?? '';
      const appPath = await resolveAppPath(workspaceId);
      sendJson(res, 200, { success: true, items: await listAppGeneratedAssets(appPath) });
      return true;
    }

    // 生成资产下载（另存为）
    if (url.pathname === '/api/app-dev/generated-assets/export' && req.method === 'POST') {
      const body = await parseJsonBody<{ workspaceId: string; path: string }>(req);
      const appPath = await resolveAppPath(body.workspaceId);
      const result = await exportAppGeneratedAsset(appPath, body.path ?? '');
      sendJson(res, 200, { success: true, ...result });
      return true;
    }

    // --- Community skill package install ---
    if (url.pathname === '/api/app-dev/packages' && req.method === 'GET') {
      const workspaceId = url.searchParams.get('workspaceId') ?? '';
      const appPath = await resolveAppPath(workspaceId);
      sendJson(res, 200, { success: true, packages: await listAppDevPackageCatalog(appPath) });
      return true;
    }

    if (url.pathname === '/api/app-dev/packages/npm' && req.method === 'POST') {
      const body = await parseJsonBody<{
        workspaceId: string;
        packageName: string;
        packageId?: string;
      }>(req);
      const appPath = await resolveAppPath(body.workspaceId);
      const result = await installNpmPackage(appPath, body.packageName ?? '', {
        packageId: body.packageId,
      });
      sendJson(res, 200, { success: true, ...result });
      return true;
    }

    if (url.pathname === '/api/app-dev/packages/pip' && req.method === 'POST') {
      const body = await parseJsonBody<{
        workspaceId: string;
        packageName: string;
        packageId?: string;
      }>(req);
      const appPath = await resolveAppPath(body.workspaceId);
      const result = await installPipPackage(appPath, body.packageName ?? '', {
        packageId: body.packageId,
      });
      sendJson(res, 200, { success: true, ...result });
      return true;
    }

    // --- Community 开发辅助：install into app openspec/skills ---
    if (url.pathname === '/api/app-dev/dev-skills' && req.method === 'GET') {
      const workspaceId = url.searchParams.get('workspaceId') ?? '';
      const appPath = await resolveAppPath(workspaceId);
      sendJson(res, 200, { success: true, skills: await listAppDevAssistSkills(appPath) });
      return true;
    }

    if (url.pathname === '/api/app-dev/dev-skills/install' && req.method === 'POST') {
      const body = await parseJsonBody<{ workspaceId: string; skillId: string }>(req);
      const appPath = await resolveAppPath(body.workspaceId);
      const result = await installAppDevAssistSkill(appPath, body.skillId ?? '');
      sendJson(res, 200, { success: true, ...result });
      return true;
    }

    // --- sto-app collaboration wrapper ---
    if (url.pathname === '/api/app-dev/sto-app/status' && req.method === 'GET') {
      const workspaceId = url.searchParams.get('workspaceId') ?? '';
      const appPath = await resolveAppPath(workspaceId);
      await ensureStoWorkspaceBinding(appPath, { workspaceId }).catch(() => null);
      const status = await getStoAppStatus(appPath);
      if (!status.appCode) {
        const binding = await getStoAppBindingByWorkspaceId(workspaceId);
        if (binding?.appCode) {
          status.appCode = binding.appCode;
          status.applicationName = status.applicationName ?? binding.applicationName;
        }
      }
      if (!status.appCode) {
        const cloud = await resolveCloudAppForWorkspace(workspaceId, appPath);
        if (cloud?.appCode) {
          status.appCode = cloud.appCode;
          status.applicationName = status.applicationName ?? cloud.applicationName;
          status.revisionId = status.revisionId ?? cloud.headRevisionId;
          status.devCommitSha = status.devCommitSha ?? cloud.headCommitSha;
        }
      }
      if (status.appCode && !status.bound) {
        status.bound = true;
        status.syncLabel = status.syncLabel === '未绑定' ? '状态未知' : status.syncLabel;
      }
      sendJson(res, 200, { success: true, status });
      return true;
    }

    if (url.pathname === '/api/app-dev/sto-app/pushes' && req.method === 'GET') {
      const workspaceId = url.searchParams.get('workspaceId') ?? '';
      const appPath = await resolveAppPath(workspaceId);
      sendJson(res, 200, { success: true, items: await readStoAppPushHistory(appPath) });
      return true;
    }

    if (url.pathname === '/api/app-dev/sto-app/push' && req.method === 'POST') {
      const body = await parseJsonBody<{ workspaceId: string; message?: string }>(req);
      logger.info(
        `[app-dev] POST /api/app-dev/sto-app/push workspaceId=${body.workspaceId ?? ''} ` +
        `message=${JSON.stringify(body.message ?? '更新应用')}`,
      );
      const appPath = await resolveAppPath(body.workspaceId);
      await ensureStoWorkspaceBinding(appPath, { workspaceId: body.workspaceId }).catch(() => null);
      const result = await pushStoApp(appPath, body.message ?? '更新应用', {
        workspaceId: body.workspaceId,
      });
      logger.info(`[app-dev] POST /api/app-dev/sto-app/push result ok=${result.ok} output=${JSON.stringify(result.output)}`);
      sendJson(res, 200, { success: true, ...result });
      return true;
    }

    if (url.pathname === '/api/app-dev/sto-app/pull' && req.method === 'POST') {
      const body = await parseJsonBody<{ workspaceId: string }>(req);
      const appPath = await resolveAppPath(body.workspaceId);
      await ensureStoWorkspaceBinding(appPath, { workspaceId: body.workspaceId }).catch(() => null);
      const result = await pullStoApp(appPath);
      sendJson(res, 200, { success: true, ...result });
      return true;
    }

    if (url.pathname === '/api/app-dev/sto-app/merge-continue' && req.method === 'POST') {
      const body = await parseJsonBody<{ workspaceId: string; revisionId: string }>(req);
      const appPath = await resolveAppPath(body.workspaceId);
      const result = await continueStoAppMerge(appPath, body.revisionId ?? '');
      sendJson(res, 200, { success: true, ...result });
      return true;
    }

    if (url.pathname === '/api/app-dev/sto-app/deploy' && req.method === 'POST') {
      const body = await parseJsonBody<{
        workspaceId?: string;
        env?: string;
        appCode?: string;
        requestId?: string;
        deploymentVersion?: string;
        pushMessage?: string;
      }>(req);
      const workspaceId = body.workspaceId ?? '';
      logger.info(
        `[app-dev] deploy:start workspaceId=${workspaceId} body=${serializeForAppDevLog(body)}`,
      );
      if (!workspaceId) throw new Error('缺少 workspaceId');
      const appPath = await resolveAppPath(workspaceId);

      await ensureStoWorkspaceBinding(appPath, { workspaceId }).catch(() => null);

      const env = body.env;
      if (env !== 'daily' && env !== 'stage' && env !== 'online') {
        throw new Error('请选择部署环境：daily / stage / online');
      }

      await assertExternalServicesReadyForDeploy(appPath);
      logger.info(`[app-dev] deploy:preflight-ok workspaceId=${workspaceId} env=${env}`);

      // Push first — also registers the cloud Site App on first commit.
      const pushMessage = (body.pushMessage ?? `发布前同步 (${env})`).trim() || `发布前同步 (${env})`;
      logger.info(
        `[app-dev] deploy:push-start workspaceId=${workspaceId} env=${env} ` +
        `message=${JSON.stringify(pushMessage)}`,
      );
      const pushResult = await pushStoApp(appPath, pushMessage, { workspaceId });
      logger.info(`[app-dev] deploy:push-done ${serializeForAppDevLog(pushResult)}`);

      const status = await getStoAppStatus(appPath);
      const binding = await getStoAppBindingByWorkspaceId(workspaceId);
      const cloud = await resolveCloudAppForWorkspace(workspaceId, appPath);
      const appCode = (
        body.appCode
        ?? status.appCode
        ?? binding?.appCode
        ?? cloud?.appCode
        ?? ''
      ).trim();
      logger.info(
        `[app-dev] deploy:resolved appPath=${appPath} appCode=${appCode} ` +
        `status=${serializeForAppDevLog({
          syncState: status.syncState,
          syncLabel: status.syncLabel,
          appCode: status.appCode,
          bound: status.bound,
        })} binding=${serializeForAppDevLog(binding)} ` +
        `cloud=${serializeForAppDevLog(summarizeDeployCloud(cloud))}`,
      );
      if (!appCode) {
        throw new Error('缺少 appCode：提交后未能注册云端应用');
      }

      const activated = await ensureSiteAppActiveForDeploy(appCode);
      logger.info(
        `[app-dev] deploy:site-app-active appCode=${appCode} status=${activated.status ?? '-'}`,
      );

      const deployParams = resolveSiteappDeployCreateParams({
        env,
        appCode,
        requestId: body.requestId,
        deploymentVersion: body.deploymentVersion,
      });
      logger.info(`[app-dev] deploy:create-start params=${serializeForAppDevLog(deployParams)}`);
      let deployJson: unknown;
      let deployError: unknown;
      try {
        deployJson = await createSiteAppDeploy({
          appCode,
          env,
          requestId: deployParams.request_id,
          deploymentVersion: deployParams.deployment_version,
        });
      } catch (error) {
        deployError = error;
        logger.error(`[app-dev] deploy:create-failed ${serializeForAppDevLog({
          error: siteAppHttpErrorMessage(error, '发布失败'),
        })}`);
      }
      const outcome = resolveDeployCreatePayload(deployJson, deployParams, deployError);
      if ('error' in outcome) {
        logger.error(`[app-dev] deploy:create-error-detail ${outcome.error}`);
        throw new Error(outcome.error);
      }
      logger.info(`[app-dev] deploy:create-ok ${serializeForAppDevLog(outcome.data)}`);
      sendJson(res, 200, {
        success: true,
        appCode,
        env,
        pushed: true,
        data: outcome.data ?? null,
      });
      return true;
    }

    if (url.pathname === '/api/app-dev/sto-app/deploy/refresh' && req.method === 'POST') {
      const body = await parseJsonBody<{ deploymentId?: string; appCode?: string; workspaceId?: string }>(req);
      const deploymentId = (body.deploymentId ?? '').trim();
      logger.info(`[app-dev] deploy:refresh-start body=${serializeForAppDevLog(body)}`);
      if (!deploymentId) throw new Error('缺少 deploymentId');

      let appCode = (body.appCode ?? '').trim();
      if (!appCode && body.workspaceId?.trim()) {
        const appPath = await resolveAppPath(body.workspaceId.trim());
        const status = await getStoAppStatus(appPath);
        appCode = status.appCode?.trim() ?? '';
      }
      if (!appCode) throw new Error('缺少 appCode');

      try {
        const data = await refreshSiteAppDeploy({ appCode, deploymentId });
        logger.info(
          `[app-dev] deploy:refresh-ok deploymentId=${deploymentId} appCode=${appCode} ` +
          `data=${serializeForAppDevLog(data)}`,
        );
        sendJson(res, 200, {
          success: true,
          deploymentId,
          data: data ?? null,
        });
      } catch (error) {
        const message = siteAppHttpErrorMessage(error, '刷新部署状态失败');
        logger.error(
          `[app-dev] deploy:refresh-failed deploymentId=${deploymentId} appCode=${appCode} ${message}`,
        );
        throw new Error(message);
      }
      return true;
    }

    if (url.pathname === '/api/app-dev/sto-app/deploy/history' && req.method === 'GET') {
      const workspaceId = url.searchParams.get('workspaceId') ?? '';
      if (!workspaceId.trim()) throw new Error('缺少 workspaceId');
      const appPath = await resolveAppPath(workspaceId.trim());
      const { readStoAppDeployHistory } = await import('../../services/sto-app-deploy-history-store');
      sendJson(res, 200, { success: true, items: await readStoAppDeployHistory(appPath) });
      return true;
    }

    if (url.pathname === '/api/app-dev/sto-app/deploy/history' && req.method === 'POST') {
      const body = await parseJsonBody<{
        workspaceId?: string;
        record?: unknown;
      }>(req);
      const workspaceId = (body.workspaceId ?? '').trim();
      if (!workspaceId) throw new Error('缺少 workspaceId');
      const { parseStoAppDeployHistoryRecord } = await import('../../../shared/sto-app-deploy-history');
      const record = parseStoAppDeployHistoryRecord(body.record);
      if (!record) throw new Error('缺少有效的 deploymentId，无法写入发布记录');
      const appPath = await resolveAppPath(workspaceId);
      const { upsertStoAppDeployHistory } = await import('../../services/sto-app-deploy-history-store');
      const items = await upsertStoAppDeployHistory(appPath, record);
      sendJson(res, 200, { success: true, items });
      return true;
    }

    if (url.pathname === '/api/app-dev/sto-app/menu/preview' && req.method === 'POST') {
      const body = await parseJsonBody<{
        workspaceId?: string;
        pageType?: string;
        appName?: string;
      }>(req);
      const workspaceId = (body.workspaceId ?? '').trim();
      if (!workspaceId) throw new Error('缺少 workspaceId');
      const appPath = await resolveAppPath(workspaceId);
      const { previewSiteappMenusFromApp } = await import('../../services/siteapp-menu-preview');
      const preview = await previewSiteappMenusFromApp({
        appPath,
        pageType: body.pageType,
        appName: body.appName,
      });
      sendJson(res, 200, { success: true, ...preview });
      return true;
    }

    if (url.pathname === '/api/app-dev/sto-app/menu/sync' && req.method === 'POST') {
      const body = await parseJsonBody<{
        workspaceId?: string;
        appCode?: string;
        menus?: unknown;
      }>(req);
      const workspaceId = (body.workspaceId ?? '').trim();
      if (!workspaceId) throw new Error('缺少 workspaceId');
      const appPath = await resolveAppPath(workspaceId);
      const { previewSiteappMenusFromApp } = await import('../../services/siteapp-menu-preview');
      const preview = await previewSiteappMenusFromApp({ appPath });
      const appCode = (body.appCode ?? preview.appCode ?? '').trim();
      if (!appCode) throw new Error('缺少 appCode：请先提交/发布以绑定云端应用');
      const menus = Array.isArray(body.menus) ? body.menus : preview.menus;
      if (!Array.isArray(menus) || menus.length === 0) {
        throw new Error('没有可同步的菜单');
      }
      const { buildSiteappMenuSyncParams } = await import('../../../shared/siteapp-menu-sync');
      const params = buildSiteappMenuSyncParams({
        appCode,
        menus: menus as import('../../../shared/siteapp-menu-sync').SiteappMenuItemInput[],
      });
      const data = await syncSiteAppMenus(params);
      sendJson(res, 200, { success: true, appCode, data: data ?? null });
      return true;
    }

    return false;
  } catch (error) {
    logger.error('[app-dev] route error:', error);
    const requestedStatus = typeof error === 'object' && error !== null && 'statusCode' in error
      ? Number((error as { statusCode?: unknown }).statusCode)
      : 500;
    const statusCode = Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus < 600
      ? requestedStatus
      : 500;
    sendJson(res, statusCode, { success: false, error: error instanceof Error ? error.message : String(error) });
    return true;
  }
}
