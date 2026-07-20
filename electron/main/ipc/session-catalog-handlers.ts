import { ipcMain } from 'electron';
import { DEFAULT_WORKSPACE_ID } from '../../db/models/domain/session-catalog';
import { logger } from '../../utils/logger';
import {
  bindSessionToWorkspace,
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
  softDeleteCatalogSession,
  updateWorkspace,
  upsertCatalogSession,
} from '../../services/session-catalog-service';
import { getSessionGroupRepository } from '../../db/repositories/session-group-repository';
import type { GatewayManager } from '../../gateway/manager';

let gatewayManagerRef: GatewayManager | null = null;
async function getGatewayManager(): Promise<GatewayManager | null> {
  if (gatewayManagerRef) return gatewayManagerRef;
  try {
    const mainModule = await import('../index');
    gatewayManagerRef = mainModule.gatewayManager ?? null;
    return gatewayManagerRef;
  } catch (error) {
    logger.warn('[session-catalog] failed to resolve gatewayManager from main module', error);
    return null;
  }
}

type SessionCatalogInvokeRequest = {
  action: string;
  payload?: Record<string, unknown>;
};

let handlersRegistered = false;

export function registerSessionCatalogHandlers(): void {
  if (handlersRegistered) {
    logger.info('[session-catalog] IPC handler already registered, skip');
    return;
  }
  handlersRegistered = true;
  logger.info('[session-catalog] registering IPC handler session-catalog:invoke');
  console.info('[session-catalog] registering IPC handler session-catalog:invoke');
  ipcMain.handle('session-catalog:invoke', async (_event, request: SessionCatalogInvokeRequest) => {
    const action = request?.action ?? '';
    const payload = request?.payload ?? {};
    const startedAt = Date.now();

    try {
      const result = await dispatchSessionCatalogAction(action, payload);
      if (action === 'bootstrap' || action === 'listWorkspaces' || action === 'createWorkspace') {
        const workspaceCount = Array.isArray((result as { workspaces?: unknown[] })?.workspaces)
          ? (result as { workspaces: unknown[] }).workspaces.length
          : undefined;
        logger.info(
          `[session-catalog] action=${action} ok durationMs=${Date.now() - startedAt}`
          + (workspaceCount != null ? ` workspaces=${workspaceCount}` : ''),
        );
      }
      return result;
    } catch (error) {
      logger.error(`[session-catalog] action=${action} failed:`, error);
      throw error;
    }
  });
}

async function dispatchSessionCatalogAction(
  action: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  switch (action) {
      case 'bootstrap':
        await ensureSessionCatalogBootstrapped();
        return { success: true };

      case 'listWorkspaces':
        return { workspaces: await listUserWorkspaces() };

      case 'createWorkspace':
        return {
          workspace: await createWorkspace({
            name: String(payload.name ?? ''),
            rootPath: String(payload.rootPath ?? ''),
          }, await getGatewayManager()),
        };

      case 'ensureProjectAgent':
        return {
          ...(await ensureWorkspaceProjectAgent(
            String(payload.workspaceId ?? ''),
            payload.baseAgentId != null ? String(payload.baseAgentId) : 'main',
            await getGatewayManager(),
          )),
        };

      case 'updateWorkspace':
        return {
          workspace: await updateWorkspace(String(payload.id ?? ''), {
            name: payload.name != null ? String(payload.name) : undefined,
            rootPath: payload.rootPath != null ? String(payload.rootPath) : undefined,
          }, await getGatewayManager()),
        };

      case 'deleteWorkspace': {
        const result = await deleteWorkspace(String(payload.id ?? ''), await getGatewayManager());
        return { success: true, ...result };
      }

      case 'listCatalogSessions':
        return {
          sessions: await listCatalogSessions(String(payload.workspaceId ?? DEFAULT_WORKSPACE_ID)),
        };

      case 'listBindings':
        return { bindings: await listAllSessionWorkspaceBindings() };

      case 'bindSession':
        await bindSessionToWorkspace(
          String(payload.sessionKey ?? ''),
          String(payload.workspaceId ?? DEFAULT_WORKSPACE_ID),
          await getGatewayManager(),
        );
        return { success: true };

      case 'moveSession':
        return {
          session: await moveSessionToWorkspace(
            String(payload.sessionKey ?? ''),
            String(payload.workspaceId ?? DEFAULT_WORKSPACE_ID),
            await getGatewayManager(),
          ),
        };

      case 'patchSession':
        return {
          session: await upsertCatalogSession({
            workspaceId: String(payload.workspaceId ?? DEFAULT_WORKSPACE_ID),
            sessionKey: String(payload.sessionKey ?? ''),
            groupId: payload.groupId as string | null | undefined,
            sessionType: payload.sessionType as import('../../db/models/domain/session-catalog').CatalogSession['sessionType'] | null | undefined,
            taskId: payload.taskId as string | null | undefined,
            appId: payload.appId as string | null | undefined,
            channelType: payload.channelType as string | null | undefined,
            channelId: payload.channelId as string | null | undefined,
            title: payload.title as string | null | undefined,
            pinRank: payload.pinRank as number | null | undefined,
            lastActivityAt: payload.lastActivityAt as string | null | undefined,
          }),
        };

      case 'deleteSession':
        return {
          success: await softDeleteCatalogSession(
            String(payload.workspaceId ?? DEFAULT_WORKSPACE_ID),
            String(payload.sessionKey ?? ''),
          ),
        };

      case 'listGroups':
        return {
          groups: await listWorkspaceGroups(String(payload.workspaceId ?? DEFAULT_WORKSPACE_ID)),
        };

      case 'createGroup':
        return {
          group: await createWorkspaceGroup(
            String(payload.workspaceId ?? DEFAULT_WORKSPACE_ID),
            String(payload.name ?? ''),
            payload.id != null ? String(payload.id) : undefined,
          ),
        };

      case 'renameGroup': {
        const groupRepo = getSessionGroupRepository();
        return {
          group: await groupRepo.update(String(payload.id ?? ''), {
            name: payload.name != null ? String(payload.name) : undefined,
            sortOrder: typeof payload.sortOrder === 'number' ? payload.sortOrder : undefined,
          }),
        };
      }

      case 'migrateLocalStorage':
        if (payload.sidebarGroups) {
          await importLegacySidebarGroups(payload.sidebarGroups as Parameters<typeof importLegacySidebarGroups>[0]);
        }
        if (payload.sessionLabels) {
          await importLegacySessionLabels(payload.sessionLabels as Parameters<typeof importLegacySessionLabels>[0]);
        }
        return { success: true };

      default:
        throw new Error(`Unknown session-catalog action: ${action}`);
  }
}
