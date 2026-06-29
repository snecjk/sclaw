/**
 * SessionUnreadStore — 最近/任务会话未读红点（运行成功完成且非当前查看会话时打标）。
 *
 * persist 到 localStorage，重启保留；与 sto-task-subitems 未读模型独立。
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
  markSessionUnread: (sessionKey: string) => void;
  markSessionRead: (sessionKey: string) => void;
}

export const useSessionUnreadStore = create<SessionUnreadState>()(
  persist(
    (set) => ({
      unreadKeys: {},

      markSessionUnread: (sessionKey) => {
        const canonical = canonicalSessionUnreadKey(sessionKey);
        if (!canonical) return;
        set((s) => ({ unreadKeys: { ...s.unreadKeys, [canonical]: true } }));
      },

      markSessionRead: (sessionKey) => {
        const aliases = collectSessionUnreadAliases(sessionKey);
        if (aliases.length === 0) return;
        set((s) => {
          const hasAny = aliases.some((key) => s.unreadKeys[key]);
          if (!hasAny) return s;
          const next = { ...s.unreadKeys };
          for (const key of aliases) {
            delete next[key];
          }
          return { unreadKeys: next };
        });
      },
    }),
    {
      name: 'stoclaw:session-unread',
      partialize: (state) => ({ unreadKeys: state.unreadKeys }),
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
