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
    // (sto-app CLI / login failures would otherwise leak app-dev into 项目).
    let ids: string[] = [];
    try {
      ids = await listDevAppWorkspaceIds();
    } catch {
      ids = [];
    }

    let apps: DevAppSummary[] = get().apps;
    try {
      apps = await listDevApps();
    } catch {
      // Keep previous apps; sidebar hide still uses marker-based ids above.
    }

    const merged = Array.from(new Set([...get().workspaceIds, ...ids]));
    set({ workspaceIds: merged, apps, loaded: true });
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
