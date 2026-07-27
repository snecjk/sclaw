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
  isAppDevWorkspace: (workspaceId: string) => boolean;
}

export const useAppDevCatalogStore = create<AppDevCatalogState>((set, get) => ({
  workspaceIds: [],
  apps: [],
  loaded: false,
  refresh: async () => {
    try {
      const [ids, apps] = await Promise.all([
        listDevAppWorkspaceIds(),
        listDevApps(),
      ]);
      // Keep any optimistically registered ids that the API hasn't listed yet.
      const merged = Array.from(new Set([...get().workspaceIds, ...ids]));
      set({ workspaceIds: merged, apps, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  registerWorkspaceId: (workspaceId) => {
    const id = workspaceId.trim();
    if (!id) return;
    const current = get().workspaceIds;
    if (current.includes(id)) return;
    set({ workspaceIds: [...current, id] });
  },
  isAppDevWorkspace: (workspaceId) => get().workspaceIds.includes(workspaceId),
}));
