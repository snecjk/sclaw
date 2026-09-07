import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import {
  bindSessionToWorkspace,
  createBlankWorkspaceFolder,
  createWorkspace,
  createWorkspaceGroup,
  deleteWorkspace,
  ensureSessionCatalogBootstrapped,
  ensureWorkspaceProjectAgent,
  importLegacySessionLabels,
  importLegacySidebarGroups,
  listAllSessionWorkspaceBindings,
  listCatalogSessions,
  listUserWorkspaces,
  listWorkspaceGroups,
  moveSessionToWorkspace,
  pickWorkspaceFolder,
  softDeleteCatalogSession,
  upsertCatalogSession,
  updateWorkspace,
} from '../../services/session-catalog-service';
import { getSessionGroupRepository } from '../../db/repositories/session-group-repository';
import { DEFAULT_WORKSPACE_ID } from '../../db/models/domain/session-catalog';
import type { AgentEngineType } from '../../engines/types';

export async function handleSessionCatalogRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/session-catalog/bootstrap' && req.method === 'POST') {
    try {
      await ensureSessionCatalogBootstrapped();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/session-catalog/workspaces' && req.method === 'GET') {
    try {
      const workspaces = await listUserWorkspaces();
      sendJson(res, 200, { workspaces });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/session-catalog/workspaces/pick-folder' && req.method === 'POST') {
    try {
      const rootPath = await pickWorkspaceFolder(_ctx.mainWindow);
      sendJson(res, 200, { rootPath });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/session-catalog/workspaces/create-blank-folder' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ parentPath: string; folderName: string }>(req);
      const rootPath = await createBlankWorkspaceFolder(body.parentPath ?? '', body.folderName ?? '');
      sendJson(res, 200, { rootPath });
    } catch (error) {
      sendJson(res, 400, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/session-catalog/workspaces' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ name: string; rootPath: string }>(req);
      const workspace = await createWorkspace({
        name: body.name ?? '',
        rootPath: body.rootPath ?? '',
      }, _ctx.gatewayManager);
      sendJson(res, 200, { workspace });
    } catch (error) {
      sendJson(res, 400, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/session-catalog/project-agent/ensure' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ workspaceId: string; baseAgentId?: string }>(req);
      const result = await ensureWorkspaceProjectAgent(
        body.workspaceId ?? '',
        body.baseAgentId ?? 'main',
        _ctx.gatewayManager,
      );
      sendJson(res, 200, { success: true, ...result });
    } catch (error) {
      sendJson(res, 400, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/session-catalog/workspaces' && req.method === 'PATCH') {
    try {
      const body = await parseJsonBody<{ id: string; name?: string; rootPath?: string }>(req);
      const workspace = await updateWorkspace(body.id ?? '', {
        name: body.name,
        rootPath: body.rootPath,
      }, _ctx.gatewayManager);
      sendJson(res, 200, { workspace });
    } catch (error) {
      sendJson(res, 400, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/session-catalog/workspaces/delete' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ id: string }>(req);
      const result = await deleteWorkspace(body.id ?? '', _ctx.gatewayManager);
      sendJson(res, 200, { success: true, ...result });
    } catch (error) {
      sendJson(res, 400, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/session-catalog/groups' && req.method === 'GET') {
    try {
      const workspaceId = url.searchParams.get('workspaceId') ?? DEFAULT_WORKSPACE_ID;
      const groups = await listWorkspaceGroups(workspaceId);
      sendJson(res, 200, { groups });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/session-catalog/sessions/bind' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ sessionKey: string; workspaceId: string; engineType?: unknown }>(req);
      const engineType = body.engineType === 'claude' || body.engineType === 'pi' || body.engineType === 'openclaw'
        ? body.engineType as AgentEngineType
        : undefined;
      await bindSessionToWorkspace(
        body.sessionKey ?? '',
        body.workspaceId ?? DEFAULT_WORKSPACE_ID,
        _ctx.gatewayManager,
        engineType,
      );
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 400, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/session-catalog/sessions/move' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ sessionKey: string; workspaceId: string; engineType?: unknown }>(req);
      const engineType = body.engineType === 'claude' || body.engineType === 'pi' || body.engineType === 'openclaw'
        ? body.engineType as AgentEngineType
        : undefined;
      const session = await moveSessionToWorkspace(
        body.sessionKey ?? '',
        body.workspaceId ?? DEFAULT_WORKSPACE_ID,
        _ctx.gatewayManager,
        engineType,
      );
      sendJson(res, 200, { session });
    } catch (error) {
      sendJson(res, 400, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/session-catalog/sessions/bindings' && req.method === 'GET') {
    try {
      const bindings = await listAllSessionWorkspaceBindings();
      sendJson(res, 200, { bindings });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/session-catalog/groups' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ workspaceId: string; name: string; id?: string }>(req);
      const group = await createWorkspaceGroup(body.workspaceId ?? DEFAULT_WORKSPACE_ID, body.name ?? '', body.id);
      sendJson(res, 200, { group });
    } catch (error) {
      sendJson(res, 400, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/session-catalog/groups' && req.method === 'PATCH') {
    try {
      const body = await parseJsonBody<{ id: string; name?: string; sortOrder?: number }>(req);
      const groupRepo = getSessionGroupRepository();
      const group = await groupRepo.update(body.id ?? '', {
        name: body.name,
        sortOrder: body.sortOrder,
      });
      sendJson(res, 200, { group });
    } catch (error) {
      sendJson(res, 400, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/session-catalog/sessions' && req.method === 'GET') {
    try {
      const workspaceId = url.searchParams.get('workspaceId') ?? DEFAULT_WORKSPACE_ID;
      const sessions = await listCatalogSessions(workspaceId);
      sendJson(res, 200, { sessions });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/session-catalog/sessions' && req.method === 'PATCH') {
    try {
      const body = await parseJsonBody<{
        workspaceId: string;
        sessionKey: string;
        groupId?: string | null;
        sessionType?: import('../../db/models/domain/session-catalog').CatalogSession['sessionType'] | null;
        taskId?: string | null;
        appId?: string | null;
        channelType?: string | null;
        channelId?: string | null;
        title?: string | null;
        pinRank?: number | null;
        lastActivityAt?: string | null;
      }>(req);
      const session = await upsertCatalogSession({
        workspaceId: body.workspaceId ?? DEFAULT_WORKSPACE_ID,
        sessionKey: body.sessionKey ?? '',
        groupId: body.groupId,
        sessionType: body.sessionType,
        taskId: body.taskId,
        appId: body.appId,
        channelType: body.channelType,
        channelId: body.channelId,
        title: body.title,
        pinRank: body.pinRank,
        lastActivityAt: body.lastActivityAt,
      });
      sendJson(res, 200, { session });
    } catch (error) {
      sendJson(res, 400, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/session-catalog/sessions/delete' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ workspaceId: string; sessionKey: string }>(req);
      const deleted = await softDeleteCatalogSession(
        body.workspaceId ?? DEFAULT_WORKSPACE_ID,
        body.sessionKey ?? '',
      );
      sendJson(res, 200, { success: deleted });
    } catch (error) {
      sendJson(res, 400, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/session-catalog/migrate/local-storage' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        sidebarGroups?: {
          groups?: Array<{ id: string; name: string; createdAt: number; collapsed?: boolean }>;
          assignments?: Record<string, string>;
        };
        sessionLabels?: Record<string, { label?: string; updatedAt?: number }>;
      }>(req);
      if (body.sidebarGroups) {
        await importLegacySidebarGroups(body.sidebarGroups);
      }
      if (body.sessionLabels) {
        await importLegacySessionLabels(body.sessionLabels);
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
