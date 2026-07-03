/**
 * SessionUnreadStore — 最近/任务会话未读红点（运行成功完成且非当前查看会话时打标）。
 *
 * persist 到 localStorage，重启保留；与 sto-task-subitems 未读模型独立。
 *
 * 关键约束（防误标）：
 * - `unreadKeys`：会话级未读集合（canonical key）。
 * - `readAt`：会话最近一次被打开/前台完成的时间戳（canonical key → ms）。
 *   用于抑制"刚看过又被迟到/后台事件重新打标"的误报。
 * 真正的门禁逻辑集中在 `@/lib/session-unread-notify`，本 store 只负责存取。
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  canonicalSessionUnreadKey,
  collectSessionUnreadAliases,
  isSessionUnreadInStore,
} from '@/lib/session-unread-keys';

interface SessionUnreadState {
  /** sessionKey → true */
  unreadKeys: Record<string, true>;
  /** canonical sessionKey → 最近已读时间戳(ms) */
  readAt: Record<string, number>;
  markSessionUnread: (sessionKey: string) => void;
  markSessionRead: (sessionKey: string) => void;
}

export const useSessionUnreadStore = create<SessionUnreadState>()(
  persist(
    (set) => ({
      unreadKeys: {},
      readAt: {},

      markSessionUnread: (sessionKey) => {
        const canonical = canonicalSessionUnreadKey(sessionKey);
        if (!canonical) return;
        set((s) => ({ unreadKeys: { ...s.unreadKeys, [canonical]: true } }));
      },

      markSessionRead: (sessionKey) => {
        const canonical = canonicalSessionUnreadKey(sessionKey);
        const aliases = collectSessionUnreadAliases(sessionKey);
        const now = Date.now();
        set((s) => {
          const hasAny = aliases.some((key) => s.unreadKeys[key]);
          const next = hasAny ? { ...s.unreadKeys } : s.unreadKeys;
          if (hasAny) {
            for (const key of aliases) {
              delete (next as Record<string, true>)[key];
            }
          }
          const nextReadAt = canonical
            ? { ...s.readAt, [canonical]: now }
            : s.readAt;
          return { unreadKeys: next, readAt: nextReadAt };
        });
      },
    }),
    {
      name: 'stoclaw:session-unread',
      // v1: 一次性清空历史未读集合，抹掉旧版误标累计的红点（迟到/重放事件导致）。
      // 未读只是瞬时提醒，升级时重置是安全且符合预期的。
      version: 1,
      migrate: () => ({ unreadKeys: {}, readAt: {} }),
      partialize: (state) => ({
        unreadKeys: state.unreadKeys,
        readAt: state.readAt,
      }),
    },
  ),
);

export function readSessionUnread(
  unreadKeys: Record<string, true>,
  sessionKey: string,
): boolean {
  return isSessionUnreadInStore(unreadKeys, sessionKey);
}

export function isSessionUnreadNow(sessionKey: string): boolean {
  return isSessionUnreadInStore(
    useSessionUnreadStore.getState().unreadKeys,
    sessionKey,
  );
}

/** 会话最近一次已读时间戳（ms）；用于抑制刚看过又被重新打标。 */
export function getSessionReadAt(sessionKey: string): number {
  const canonical = canonicalSessionUnreadKey(sessionKey);
  if (!canonical) return 0;
  return useSessionUnreadStore.getState().readAt[canonical] ?? 0;
}

/** 仅刷新已读水位（不改动未读集合），供"当前会话前台完成/新建"场景使用。 */
export function touchSessionReadAt(sessionKey: string): void {
  const canonical = canonicalSessionUnreadKey(sessionKey);
  if (!canonical) return;
  const now = Date.now();
  useSessionUnreadStore.setState((s) => ({
    readAt: { ...s.readAt, [canonical]: now },
  }));
}
