/**
 * Lightweight store for 开发应用 workspace ids — used to hide them from the
 * sidebar / home project picker without changing session-catalog schema.
 */
import { create } from 'zustand';
import { listDevAppWorkspaceIds, listDevApps, type DevAppSummary } from '@/lib/app-dev-api';

interface AppDevCatalogState {
  workspaceIds: string[];
  apps: DevAppSummary[];
  loaded: boolean;
  refresh: () => Promise<void>;
  /** Optimistically hide a workspace from the sidebar (before / if list API lags). */
  registerWorkspaceId: (workspaceId: string) => void;
  /** Remove a workspace after delete. */
  unregisterWorkspaceId: (workspaceId: string) => void;
  isAppDevWorkspace: (workspaceId: string) => boolean;
}

export const useAppDevCatalogStore = create<AppDevCatalogState>((set, get) => ({
  workspaceIds: [],
  apps: [],
  loaded: false,
  refresh: async () => {
    // IDs drive sidebar filtering and must not depend on cloud `listDevApps`
    // (login/API failures would otherwise leak app-dev into 项目).
    let ids: string[] = [];
    try {
      ids = await listDevAppWorkspaceIds();
    } catch {
      ids = [];
    }

    const merged = Array.from(new Set([...get().workspaceIds, ...ids]));
    try {
      const apps = await listDevApps();
      set({ workspaceIds: merged, apps, loaded: true });
    } catch (error) {
      set({ workspaceIds: merged, loaded: true });
      throw error;
    }
  },
  registerWorkspaceId: (workspaceId) => {
    const id = workspaceId.trim();
    if (!id) return;
    const current = get().workspaceIds;
    if (current.includes(id)) return;
    set({ workspaceIds: [...current, id] });
  },
  unregisterWorkspaceId: (workspaceId) => {
    const id = workspaceId.trim();
    if (!id) return;
    set({
      workspaceIds: get().workspaceIds.filter((item) => item !== id),
      apps: get().apps.filter((app) => app.workspaceId !== id),
    });
  },
  isAppDevWorkspace: (workspaceId) => get().workspaceIds.includes(workspaceId),
}));
