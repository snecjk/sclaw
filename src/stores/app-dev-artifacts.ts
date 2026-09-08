/**
 * 产物卡内存索引（T09）：按 workspace 缓存，落盘走 host API。
 */
import { create } from 'zustand';
import {
  listAppArtifacts,
  putAppArtifacts,
  type AppDevArtifactRecord,
} from '@/lib/app-dev-api';

interface AppDevArtifactsState {
  byWorkspace: Record<string, AppDevArtifactRecord[]>;
  load: (workspaceId: string) => Promise<void>;
  upsert: (workspaceId: string, artifact: AppDevArtifactRecord) => Promise<void>;
  toggleFavorite: (workspaceId: string, id: string) => Promise<void>;
  getForTurn: (workspaceId: string, turnKey: string) => AppDevArtifactRecord | null;
}

export const useAppDevArtifactsStore = create<AppDevArtifactsState>((set, get) => ({
  byWorkspace: {},

  load: async (workspaceId) => {
    try {
      const items = await listAppArtifacts(workspaceId);
      set((s) => ({
        byWorkspace: { ...s.byWorkspace, [workspaceId]: items },
      }));
    } catch {
      set((s) => ({
        byWorkspace: { ...s.byWorkspace, [workspaceId]: s.byWorkspace[workspaceId] ?? [] },
      }));
    }
  },

  upsert: async (workspaceId, artifact) => {
    const prev = get().byWorkspace[workspaceId] ?? [];
    const next = [artifact, ...prev.filter((x) => x.id !== artifact.id && x.turnKey !== artifact.turnKey)].slice(0, 50);
    set((s) => ({ byWorkspace: { ...s.byWorkspace, [workspaceId]: next } }));
    await putAppArtifacts(workspaceId, next).catch(() => undefined);
  },

  toggleFavorite: async (workspaceId, id) => {
    const prev = get().byWorkspace[workspaceId] ?? [];
    const next = prev.map((item) => (
      item.id === id ? { ...item, favorite: !item.favorite } : item
    ));
    set((s) => ({ byWorkspace: { ...s.byWorkspace, [workspaceId]: next } }));
    await putAppArtifacts(workspaceId, next).catch(() => undefined);
  },

  getForTurn: (workspaceId, turnKey) => {
    const items = get().byWorkspace[workspaceId] ?? [];
    return items.find((x) => x.turnKey === turnKey) ?? null;
  },
}));
