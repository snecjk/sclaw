import { invokeIpc } from '@/lib/api-client';
import { SESSION_LABELS_STORAGE_KEY } from '@/lib/session-label';

export interface WorkspaceDto {
  id: string;
  name: string;
  rootPath: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SessionGroupDto {
  id: string;
  workspaceId: string;
  name: string;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CatalogSessionDto {
  workspaceId: string;
  sessionKey: string;
  groupId: string | null;
  title: string | null;
  pinRank: number | null;
  sortKey: string | null;
  lastActivityAt: string | null;
}

export const DEFAULT_WORKSPACE_ID = 'default';

async function invokeCatalog<T>(action: string, payload?: Record<string, unknown>): Promise<T> {
  return invokeIpc<T>('session-catalog:invoke', { action, payload });
}

export async function bootstrapSessionCatalog(): Promise<void> {
  await invokeCatalog('bootstrap');
}

export async function listWorkspaces(): Promise<WorkspaceDto[]> {
  const res = await invokeCatalog<{ workspaces: WorkspaceDto[] }>('listWorkspaces');
  return res.workspaces ?? [];
}

export async function pickProjectFolder(): Promise<string | null> {
  const result = await invokeIpc<{ canceled: boolean; filePaths?: string[] }>('dialog:open', {
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths?.length) return null;
  return result.filePaths[0] ?? null;
}

export async function updateProjectWorkspace(input: {
  id: string;
  name?: string;
  rootPath?: string;
}): Promise<WorkspaceDto> {
  const res = await invokeCatalog<{ workspace: WorkspaceDto }>('updateWorkspace', input);
  return res.workspace;
}

export async function deleteProjectWorkspace(id: string): Promise<{ movedSessionCount: number }> {
  const res = await invokeCatalog<{ success: boolean; movedSessionCount: number }>('deleteWorkspace', { id });
  return { movedSessionCount: res.movedSessionCount ?? 0 };
}

export async function createProjectWorkspace(input: {
  name: string;
  rootPath: string;
}): Promise<WorkspaceDto> {
  const res = await invokeCatalog<{ workspace: WorkspaceDto }>('createWorkspace', input);
  return res.workspace;
}

export async function listSessionGroups(workspaceId: string): Promise<SessionGroupDto[]> {
  const res = await invokeCatalog<{ groups: SessionGroupDto[] }>('listGroups', { workspaceId });
  return res.groups ?? [];
}

export async function createSessionGroup(input: {
  workspaceId: string;
  name: string;
  id?: string;
}): Promise<SessionGroupDto> {
  const res = await invokeCatalog<{ group: SessionGroupDto }>('createGroup', input);
  return res.group;
}

export async function renameSessionGroup(id: string, name: string): Promise<SessionGroupDto> {
  const res = await invokeCatalog<{ group: SessionGroupDto }>('renameGroup', { id, name });
  return res.group;
}

export async function listCatalogSessions(workspaceId: string): Promise<CatalogSessionDto[]> {
  const res = await invokeCatalog<{ sessions: CatalogSessionDto[] }>('listCatalogSessions', { workspaceId });
  return res.sessions ?? [];
}

export async function loadCatalogForWorkspace(workspaceId: string): Promise<{
  sessions: CatalogSessionDto[];
  groups: SessionGroupDto[];
}> {
  const [sessions, groups] = await Promise.all([
    listCatalogSessions(workspaceId),
    listSessionGroups(workspaceId),
  ]);
  return { sessions, groups };
}

export async function patchCatalogSession(input: {
  workspaceId: string;
  sessionKey: string;
  groupId?: string | null;
  title?: string | null;
  pinRank?: number | null;
  lastActivityAt?: string | null;
}): Promise<CatalogSessionDto> {
  const res = await invokeCatalog<{ session: CatalogSessionDto }>('patchSession', input);
  return res.session;
}

export async function bindSessionToCatalog(sessionKey: string, workspaceId: string): Promise<void> {
  await invokeCatalog('bindSession', { sessionKey, workspaceId });
}

export async function moveSessionInCatalog(
  sessionKey: string,
  workspaceId: string,
): Promise<CatalogSessionDto> {
  const res = await invokeCatalog<{ session: CatalogSessionDto }>('moveSession', { sessionKey, workspaceId });
  return res.session;
}

export async function listAllSessionWorkspaceBindings(): Promise<Record<string, string>> {
  const res = await invokeCatalog<{ bindings: Record<string, string> }>('listBindings');
  return res.bindings ?? {};
}

export async function deleteCatalogSession(workspaceId: string, sessionKey: string): Promise<void> {
  await invokeCatalog('deleteSession', { workspaceId, sessionKey });
}

export async function migrateLegacyCatalogFromLocalStorage(): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  let sidebarGroups: unknown;
  let sessionLabels: unknown;
  try {
    const groupsRaw = localStorage.getItem('stoclaw:sidebar-recent-groups');
    if (groupsRaw) {
      const parsed = JSON.parse(groupsRaw) as { state?: Record<string, unknown> };
      sidebarGroups = parsed?.state ?? parsed;
    }
    const labelsRaw = localStorage.getItem(SESSION_LABELS_STORAGE_KEY);
    if (labelsRaw) {
      const parsed = JSON.parse(labelsRaw) as {
        state?: { sessionLabels?: Record<string, string>; sessionLastActivity?: Record<string, number> };
      };
      const labels = parsed?.state?.sessionLabels ?? {};
      const activity = parsed?.state?.sessionLastActivity ?? {};
      sessionLabels = Object.fromEntries(
        Object.keys({ ...labels, ...activity }).map((key) => [
          key,
          { label: labels[key], updatedAt: activity[key] },
        ]),
      );
    }
  } catch {
    return;
  }
  if (!sidebarGroups && !sessionLabels) return;
  await invokeCatalog('migrateLocalStorage', { sidebarGroups, sessionLabels });
}
