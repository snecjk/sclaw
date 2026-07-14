/**
 * Session catalog store — user projects (workspaces), session bindings, catalog cache.
 */
import { create } from 'zustand';
import {
  bindSessionToCatalog,
  bootstrapSessionCatalog,
  createProjectWorkspace,
  deleteProjectWorkspace,
  listAllSessionWorkspaceBindings,
  listCatalogSessions,
  migrateLegacyCatalogFromLocalStorage,
  moveSessionInCatalog,
  pickProjectFolder,
  updateProjectWorkspace,
  type CatalogSessionDto,
  type WorkspaceDto,
} from '@/lib/session-catalog-api';

export const DEFAULT_WORKSPACE_ID = 'default';

export type CatalogSessionMeta = {
  pinRank: number | null;
  lastActivityAt: string | null;
};

/** Persist across Electron restarts — sessionStorage clears every app launch. */
const MIGRATION_FLAG = 'stoclaw:session-catalog-migrated';

let bootstrapInFlight: Promise<void> | null = null;

interface SessionCatalogState {
  ready: boolean;
  workspaces: WorkspaceDto[];
  selectedProjectId: string | null;
  catalogSessions: CatalogSessionDto[];
  allCatalogByKey: Record<string, CatalogSessionMeta>;
  sessionWorkspaceByKey: Record<string, string>;

  bootstrap: () => Promise<void>;
  refreshWorkspaces: () => Promise<void>;
  refreshAllBindings: () => Promise<void>;
  refreshAllCatalogMeta: () => Promise<void>;
  selectProject: (workspaceId: string | null) => Promise<void>;
  bindSession: (sessionKey: string) => Promise<void>;
  moveSessionToProject: (sessionKey: string, projectId: string | null) => Promise<void>;
  createProject: (name: string, rootPath: string) => Promise<WorkspaceDto | null>;
  updateProject: (id: string, name: string, rootPath: string) => Promise<void>;
  deleteProject: (id: string) => Promise<number>;
  pickFolder: () => Promise<string | null>;
  patchSessionCatalog: (input: {
    sessionKey: string;
    title?: string | null;
    pinRank?: number | null;
    lastActivityAt?: string | null;
  }) => Promise<void>;
  softDeleteSession: (sessionKey: string) => Promise<void>;
  activeWorkspaceId: () => string;
}

function readMigrationFlag(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(MIGRATION_FLAG) === '1';
  } catch {
    return false;
  }
}

function writeMigrationFlag(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(MIGRATION_FLAG, '1');
    }
  } catch {
    // ignore quota / private mode
  }
}

export const useSessionCatalogStore = create<SessionCatalogState>((set, get) => ({
  ready: false,
  workspaces: [],
  selectedProjectId: null,
  catalogSessions: [],
  allCatalogByKey: {},
  sessionWorkspaceByKey: {},

  activeWorkspaceId: () => get().selectedProjectId ?? DEFAULT_WORKSPACE_ID,

  refreshAllCatalogMeta: async () => {
    const workspaces = get().workspaces;
    const batches = await Promise.all([
      listCatalogSessions(DEFAULT_WORKSPACE_ID),
      ...workspaces.map((workspace) => listCatalogSessions(workspace.id)),
    ]);
    const allCatalogByKey = Object.fromEntries(
      batches.flat().map((row) => [
        row.sessionKey,
        { pinRank: row.pinRank, lastActivityAt: row.lastActivityAt },
      ]),
    );
    const targetId = get().selectedProjectId ?? DEFAULT_WORKSPACE_ID;
    set({
      allCatalogByKey,
      catalogSessions: await listCatalogSessions(targetId),
    });
  },

  bootstrap: async () => {
    if (get().ready) return;
    if (bootstrapInFlight) {
      await bootstrapInFlight;
      return;
    }

    bootstrapInFlight = (async () => {
      try {
        await bootstrapSessionCatalog();
      } catch (error) {
        console.error('[session-catalog] main bootstrap failed', error);
      }

      // Legacy migrate must never block loading existing SQLite projects.
      if (!readMigrationFlag()) {
        try {
          await migrateLegacyCatalogFromLocalStorage();
        } catch (error) {
          console.warn('[session-catalog] legacy localStorage migrate failed (continuing)', error);
        } finally {
          writeMigrationFlag();
        }
      }

      try {
        await get().refreshWorkspaces();
        await get().refreshAllBindings();
        await get().refreshAllCatalogMeta();
        set({ ready: true });
        console.info(
          `[session-catalog] renderer ready workspaces=${get().workspaces.length}`,
        );
      } catch (error) {
        console.error('[session-catalog] failed to load projects from sqlite', error);
        throw error;
      }
    })();

    try {
      await bootstrapInFlight;
    } finally {
      bootstrapInFlight = null;
    }
  },

  refreshWorkspaces: async () => {
    const { listWorkspaces } = await import('@/lib/session-catalog-api');
    const workspaces = await listWorkspaces();
    set({ workspaces });
  },

  refreshAllBindings: async () => {
    const bindings = await listAllSessionWorkspaceBindings();
    set({ sessionWorkspaceByKey: bindings });
  },

  selectProject: async (workspaceId) => {
    const targetId = workspaceId ?? DEFAULT_WORKSPACE_ID;
    const sessions = await listCatalogSessions(targetId);
    set({
      selectedProjectId: workspaceId,
      catalogSessions: sessions,
    });
  },

  bindSession: async (sessionKey) => {
    const workspaceId = get().activeWorkspaceId();
    await bindSessionToCatalog(sessionKey, workspaceId);
    set((state) => ({
      sessionWorkspaceByKey: { ...state.sessionWorkspaceByKey, [sessionKey]: workspaceId },
    }));
    await get().refreshAllCatalogMeta();
  },

  moveSessionToProject: async (sessionKey, projectId) => {
    const workspaceId = projectId ?? DEFAULT_WORKSPACE_ID;
    await moveSessionInCatalog(sessionKey, workspaceId);
    const { useChatStore } = await import('@/stores/chat');
    const title = useChatStore.getState().sessionLabels[sessionKey]?.trim();
    if (title) {
      const { patchCatalogSession } = await import('@/lib/session-catalog-api');
      await patchCatalogSession({ workspaceId, sessionKey, title }).catch(() => undefined);
    }
    set((state) => ({
      sessionWorkspaceByKey: { ...state.sessionWorkspaceByKey, [sessionKey]: workspaceId },
    }));
    await get().refreshAllCatalogMeta();
  },

  createProject: async (name, rootPath) => {
    const workspace = await createProjectWorkspace({ name, rootPath });
    await get().refreshWorkspaces();
    set({ selectedProjectId: workspace.id });
    await get().refreshAllCatalogMeta();
    return workspace;
  },

  updateProject: async (id, name, rootPath) => {
    await updateProjectWorkspace({ id, name, rootPath });
    await get().refreshWorkspaces();
    await get().refreshAllCatalogMeta();
    if (get().selectedProjectId === id) {
      await get().selectProject(id);
    }
  },

  deleteProject: async (id) => {
    const { movedSessionCount } = await deleteProjectWorkspace(id);
    if (get().selectedProjectId === id) {
      set({ selectedProjectId: null });
    }
    await get().refreshWorkspaces();
    await get().refreshAllBindings();
    await get().refreshAllCatalogMeta();
    return movedSessionCount;
  },

  pickFolder: () => pickProjectFolder(),

  patchSessionCatalog: async (input) => {
    const workspaceId = get().sessionWorkspaceByKey[input.sessionKey]
      ?? DEFAULT_WORKSPACE_ID;
    const { patchCatalogSession } = await import('@/lib/session-catalog-api');
    await patchCatalogSession({ workspaceId, ...input });
    await get().refreshAllCatalogMeta();
  },

  softDeleteSession: async (sessionKey) => {
    const workspaceId = get().sessionWorkspaceByKey[sessionKey] ?? get().activeWorkspaceId();
    const { deleteCatalogSession } = await import('@/lib/session-catalog-api');
    await deleteCatalogSession(workspaceId, sessionKey);
    set((state) => {
      const next = { ...state.sessionWorkspaceByKey };
      delete next[sessionKey];
      return { sessionWorkspaceByKey: next };
    });
    await get().refreshAllCatalogMeta();
  },
}));

export function isSessionInActiveWorkspace(
  sessionKey: string,
  selectedProjectId: string | null,
  sessionWorkspaceByKey: Record<string, string>,
): boolean {
  const workspaceId = sessionWorkspaceByKey[sessionKey] ?? DEFAULT_WORKSPACE_ID;
  if (!selectedProjectId) {
    return workspaceId === DEFAULT_WORKSPACE_ID;
  }
  return workspaceId === selectedProjectId;
}
