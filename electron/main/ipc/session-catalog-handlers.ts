import { ipcMain } from 'electron';
import { DEFAULT_WORKSPACE_ID } from '../../db/models/domain/session-catalog';
import {
  bindSessionToWorkspace,
  createWorkspace,
  createWorkspaceGroup,
  deleteWorkspace,
  ensureSessionCatalogBootstrapped,
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

type SessionCatalogInvokeRequest = {
  action: string;
  payload?: Record<string, unknown>;
};

export function registerSessionCatalogHandlers(): void {
  console.info('[session-catalog] registering IPC handler session-catalog:invoke');
  ipcMain.handle('session-catalog:invoke', async (_event, request: SessionCatalogInvokeRequest) => {
    const action = request?.action ?? '';
    const payload = request?.payload ?? {};

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
          }),
        };

      case 'updateWorkspace':
        return {
          workspace: await updateWorkspace(String(payload.id ?? ''), {
            name: payload.name != null ? String(payload.name) : undefined,
            rootPath: payload.rootPath != null ? String(payload.rootPath) : undefined,
          }),
        };

      case 'deleteWorkspace': {
        const result = await deleteWorkspace(String(payload.id ?? ''));
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
        );
        return { success: true };

      case 'moveSession':
        return {
          session: await moveSessionToWorkspace(
            String(payload.sessionKey ?? ''),
            String(payload.workspaceId ?? DEFAULT_WORKSPACE_ID),
          ),
        };

      case 'patchSession':
        return {
          session: await upsertCatalogSession({
            workspaceId: String(payload.workspaceId ?? DEFAULT_WORKSPACE_ID),
            sessionKey: String(payload.sessionKey ?? ''),
            groupId: payload.groupId as string | null | undefined,
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
  });
}
