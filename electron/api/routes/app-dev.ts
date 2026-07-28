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
  createCheckpoint,
  createUserApp,
  importUserApp,
  ensureAppDevContext,
  getAppDevStatus,
  isGitAvailable,
  listAppSourceFiles,
  listCheckpoints,
  listDevAppWorkspaceIds,
  listDevApps,
  readAppSourceFile,
  restoreCheckpoint,
  runSetupPipeline,
  searchAppSourceFiles,
  stopApp,
  writeAppSourceFile,
  installNpmPackage,
  installPipPackage,
  listAppDevAssistSkills,
  installAppDevAssistSkill,
  deleteDevApp,
  type CreateUserAppInput,
} from '../../services/app-dev-service';
import { getDevServerLogs, drainDevServerErrors } from '../../services/app-dev-server-manager';
import { getWorkspaceRootPath } from '../../services/session-catalog-service';
import { logger } from '../../utils/logger';
import {
  continueStoAppMerge,
  getStoAppStatus,
  pullStoApp,
  pushStoApp,
} from '../../services/sto-app-service';

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
      const apps = await listDevApps();
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
      const body = await parseJsonBody<{ workspaceId: string; deleteFiles?: boolean }>(req);
      const result = await deleteDevApp(
        body.workspaceId ?? '',
        { deleteFiles: body.deleteFiles === true },
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

    if (url.pathname === '/api/app-dev/apps/logs' && req.method === 'GET') {
      const workspaceId = url.searchParams.get('workspaceId') ?? '';
      sendJson(res, 200, { success: true, logs: getDevServerLogs(workspaceId) });
      return true;
    }

    // Drained by the workbench to feed compile/runtime errors to the agent.
    if (url.pathname === '/api/app-dev/apps/errors' && req.method === 'GET') {
      const workspaceId = url.searchParams.get('workspaceId') ?? '';
      sendJson(res, 200, { success: true, errors: drainDevServerErrors(workspaceId) });
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
      const created = await createCheckpoint(appPath, body.message ?? '应用更新');
      sendJson(res, 200, { success: true, created });
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

    // --- Community skill package install ---
    if (url.pathname === '/api/app-dev/packages/npm' && req.method === 'POST') {
      const body = await parseJsonBody<{ workspaceId: string; packageName: string }>(req);
      const appPath = await resolveAppPath(body.workspaceId);
      const result = await installNpmPackage(appPath, body.packageName ?? '');
      sendJson(res, 200, { success: true, ...result });
      return true;
    }

    if (url.pathname === '/api/app-dev/packages/pip' && req.method === 'POST') {
      const body = await parseJsonBody<{ workspaceId: string; packageName: string }>(req);
      const appPath = await resolveAppPath(body.workspaceId);
      const result = await installPipPackage(appPath, body.packageName ?? '');
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
      sendJson(res, 200, { success: true, status: await getStoAppStatus(appPath) });
      return true;
    }

    if (url.pathname === '/api/app-dev/sto-app/push' && req.method === 'POST') {
      const body = await parseJsonBody<{ workspaceId: string; message?: string }>(req);
      const appPath = await resolveAppPath(body.workspaceId);
      const result = await pushStoApp(appPath, body.message ?? '更新应用');
      sendJson(res, 200, { success: true, ...result });
      return true;
    }

    if (url.pathname === '/api/app-dev/sto-app/pull' && req.method === 'POST') {
      const body = await parseJsonBody<{ workspaceId: string }>(req);
      const appPath = await resolveAppPath(body.workspaceId);
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

    return false;
  } catch (error) {
    logger.error('[app-dev] route error:', error);
    sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    return true;
  }
}
