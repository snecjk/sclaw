/**
 * SidebarRecentGroupsStore — 最近会话自定义分组（本地 UI 辅助态，与 OpenClaw 会话生命周期独立）。
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SidebarRecentGroup {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

interface SidebarRecentGroupsState {
  groups: SidebarRecentGroup[];
  sessionGroupByKey: Record<string, string>;
  expandedGroupIds: Record<string, boolean>;

  createGroupAndAssignSession: (name: string, sessionKey: string) => string | null;
  assignSessionToGroup: (sessionKey: string, groupId: string) => void;
  ungroupSession: (sessionKey: string) => void;
  renameGroup: (groupId: string, name: string) => boolean;
  dissolveGroup: (groupId: string) => void;
  toggleGroup: (groupId: string) => void;
  expandGroup: (groupId: string) => void;
  removeSessionAssignment: (sessionKey: string) => void;
  pruneMissingSessions: (sessionKeys: string[]) => void;
}

function sortGroupsByCreatedAt(groups: SidebarRecentGroup[]): SidebarRecentGroup[] {
  return [...groups].sort((a, b) => a.createdAt - b.createdAt);
}

function trimGroupName(name: string): string {
  return name.trim();
}

export const useSidebarRecentGroupsStore = create<SidebarRecentGroupsState>()(
  persist(
    (set, get) => ({
      groups: [],
      sessionGroupByKey: {},
      expandedGroupIds: {},

      createGroupAndAssignSession: (name, sessionKey) => {
        const trimmed = trimGroupName(name);
        if (!trimmed) return null;
        const id = crypto.randomUUID();
        const now = Date.now();
        set((state) => ({
          groups: sortGroupsByCreatedAt([
            ...state.groups,
            { id, name: trimmed, createdAt: now, updatedAt: now },
          ]),
          sessionGroupByKey: { ...state.sessionGroupByKey, [sessionKey]: id },
          expandedGroupIds: { ...state.expandedGroupIds, [id]: true },
        }));
        return id;
      },

      assignSessionToGroup: (sessionKey, groupId) => {
        const group = get().groups.find((g) => g.id === groupId);
        if (!group) return;
        set((state) => ({
          sessionGroupByKey: { ...state.sessionGroupByKey, [sessionKey]: groupId },
          expandedGroupIds: { ...state.expandedGroupIds, [groupId]: true },
        }));
      },

      ungroupSession: (sessionKey) => {
        set((state) => {
          if (state.sessionGroupByKey[sessionKey] === undefined) return state;
          const next = { ...state.sessionGroupByKey };
          delete next[sessionKey];
          return { sessionGroupByKey: next };
        });
      },

      renameGroup: (groupId, name) => {
        const trimmed = trimGroupName(name);
        if (!trimmed) return false;
        set((state) => ({
          groups: sortGroupsByCreatedAt(
            state.groups.map((g) =>
              g.id === groupId ? { ...g, name: trimmed, updatedAt: Date.now() } : g,
            ),
          ),
        }));
        return true;
      },

      dissolveGroup: (groupId) => {
        set((state) => {
          const nextMapping = { ...state.sessionGroupByKey };
          for (const [key, mappedId] of Object.entries(nextMapping)) {
            if (mappedId === groupId) delete nextMapping[key];
          }
          const nextExpanded = { ...state.expandedGroupIds };
          delete nextExpanded[groupId];
          return {
            groups: state.groups.filter((g) => g.id !== groupId),
            sessionGroupByKey: nextMapping,
            expandedGroupIds: nextExpanded,
          };
        });
      },

      toggleGroup: (groupId) => {
        set((state) => ({
          expandedGroupIds: {
            ...state.expandedGroupIds,
            [groupId]: !state.expandedGroupIds[groupId],
          },
        }));
      },

      expandGroup: (groupId) => {
        set((state) => ({
          expandedGroupIds: { ...state.expandedGroupIds, [groupId]: true },
        }));
      },

      removeSessionAssignment: (sessionKey) => {
        set((state) => {
          if (state.sessionGroupByKey[sessionKey] === undefined) return state;
          const next = { ...state.sessionGroupByKey };
          delete next[sessionKey];
          return { sessionGroupByKey: next };
        });
      },

      pruneMissingSessions: (sessionKeys) => {
        const allowed = new Set(sessionKeys);
        set((state) => {
          let changed = false;
          const nextMapping = { ...state.sessionGroupByKey };
          for (const key of Object.keys(nextMapping)) {
            if (!allowed.has(key)) {
              delete nextMapping[key];
              changed = true;
            }
          }
          if (!changed) return state;
          return { sessionGroupByKey: nextMapping };
        });
      },
    }),
    {
      name: 'stoclaw:sidebar-recent-groups',
      partialize: (state) => ({
        groups: state.groups,
        sessionGroupByKey: state.sessionGroupByKey,
        expandedGroupIds: state.expandedGroupIds,
      }),
    },
  ),
);
