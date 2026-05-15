import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { StoTaskId } from '@/lib/sto-tasks';

function sortEntryIdsDesc(ids: string[]): string[] {
  return [...new Set(ids)].sort((a, b) => b.localeCompare(a));
}

/** Stable map key for `(taskId, entryId)` in `sessionKeyBySubitem` / `lastReadActivityMs`. */
export function stoTaskSubitemKey(taskId: StoTaskId, entryId: string): string {
  return `${taskId}:${entryId}`;
}

function newSubitemSessionKey(): string {
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  return `agent:main:session-sto-${id}`;
}

type EntriesByTask = Partial<Record<StoTaskId, string[]>>;

interface StoTaskSubitemsState {
  entriesByTask: EntriesByTask;
  /** OpenClaw session key per subitem; isolated transcript (not derived from taskId+date). */
  sessionKeyBySubitem: Record<string, string>;
  /** Last "read" activity timestamp (ms) per subitem; compared with chat `sessionLastActivity` for that session key. */
  lastReadActivityMs: Record<string, number>;
  ensureSubitem: (taskId: StoTaskId, entryId: string) => void;
  listEntries: (taskId: StoTaskId) => string[];
  markSubitemReadFromActivity: (taskId: StoTaskId, entryId: string, activityMs: number) => void;
  isSubitemUnread: (taskId: StoTaskId, entryId: string, activityMs: number) => boolean;
  /** Remove entry from the task list and drop its session-key mapping (after transcript delete). */
  removeSubitem: (taskId: StoTaskId, entryId: string) => void;
}

export const useStoTaskSubitemsStore = create<StoTaskSubitemsState>()(
  persist(
    (set, get) => ({
      entriesByTask: {},
      sessionKeyBySubitem: {},
      lastReadActivityMs: {},
      ensureSubitem: (taskId, entryId) => {
        set((s) => {
          const sk = stoTaskSubitemKey(taskId, entryId);
          let sessionKeys = { ...s.sessionKeyBySubitem };
          if (!sessionKeys[sk]) {
            sessionKeys[sk] = newSubitemSessionKey();
          }
          const cur = s.entriesByTask[taskId] ?? [];
          if (cur.includes(entryId)) {
            const sorted = sortEntryIdsDesc(cur);
            const entriesSame = sorted.length === cur.length && sorted.every((id, i) => id === cur[i]);
            const sessionUnchanged =
              s.sessionKeyBySubitem[sk] === sessionKeys[sk] &&
              Object.keys(sessionKeys).length === Object.keys(s.sessionKeyBySubitem).length;
            if (entriesSame && sessionUnchanged) return s;
            return {
              ...s,
              entriesByTask: entriesSame ? s.entriesByTask : { ...s.entriesByTask, [taskId]: sorted },
              sessionKeyBySubitem: sessionKeys,
            };
          }
          return {
            ...s,
            entriesByTask: { ...s.entriesByTask, [taskId]: sortEntryIdsDesc([...cur, entryId]) },
            sessionKeyBySubitem: sessionKeys,
          };
        });
      },
      listEntries: (taskId) => sortEntryIdsDesc(get().entriesByTask[taskId] ?? []),
      markSubitemReadFromActivity: (taskId, entryId, activityMs) => {
        const k = stoTaskSubitemKey(taskId, entryId);
        set((s) => {
          const prev = s.lastReadActivityMs[k] ?? 0;
          const next = Math.max(activityMs, prev);
          if (next === prev) return s;
          return {
            lastReadActivityMs: { ...s.lastReadActivityMs, [k]: next },
          };
        });
      },
      isSubitemUnread: (taskId, entryId, activityMs) => {
        if (!activityMs || activityMs <= 0) return false;
        const k = stoTaskSubitemKey(taskId, entryId);
        const last = get().lastReadActivityMs[k] ?? 0;
        return activityMs > last;
      },
      removeSubitem: (taskId, entryId) => {
        const k = stoTaskSubitemKey(taskId, entryId);
        set((s) => {
          const cur = s.entriesByTask[taskId] ?? [];
          const nextIds = sortEntryIdsDesc(cur.filter((id) => id !== entryId));
          const entriesByTask = { ...s.entriesByTask };
          if (nextIds.length === 0) {
            delete entriesByTask[taskId];
          } else {
            entriesByTask[taskId] = nextIds;
          }
          const sessionKeyBySubitem = { ...s.sessionKeyBySubitem };
          delete sessionKeyBySubitem[k];
          const lastReadActivityMs = { ...s.lastReadActivityMs };
          delete lastReadActivityMs[k];
          return { ...s, entriesByTask, sessionKeyBySubitem, lastReadActivityMs };
        });
      },
    }),
    {
      name: 'stoclaw-sto-task-subitems',
      version: 2,
      migrate: (persisted, fromVersion) => {
        const p = persisted as Partial<StoTaskSubitemsState> & { sessionKeyBySubitem?: Record<string, string> };
        if (fromVersion < 2) {
          return {
            ...p,
            sessionKeyBySubitem: p.sessionKeyBySubitem ?? {},
          } as StoTaskSubitemsState;
        }
        return persisted as StoTaskSubitemsState;
      },
    },
  ),
);
