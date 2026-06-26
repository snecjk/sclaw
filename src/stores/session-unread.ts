/**
 * SessionUnreadStore — 最近会话未读红点（运行成功完成且非当前查看会话时打标）。
 *
 * persist 到 localStorage，重启保留；与 sto-task-subitems 未读模型独立。
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SessionUnreadState {
  /** sessionKey → true */
  unreadKeys: Record<string, true>;
  markSessionUnread: (sessionKey: string) => void;
  markSessionRead: (sessionKey: string) => void;
  isSessionUnread: (sessionKey: string) => boolean;
}

export const useSessionUnreadStore = create<SessionUnreadState>()(
  persist(
    (set, get) => ({
      unreadKeys: {},

      markSessionUnread: (sessionKey) => {
        const key = sessionKey.trim();
        if (!key) return;
        set((s) => ({ unreadKeys: { ...s.unreadKeys, [key]: true } }));
      },

      markSessionRead: (sessionKey) => {
        const key = sessionKey.trim();
        if (!key) return;
        set((s) => {
          if (!s.unreadKeys[key]) return s;
          const next = { ...s.unreadKeys };
          delete next[key];
          return { unreadKeys: next };
        });
      },

      isSessionUnread: (sessionKey) => Boolean(get().unreadKeys[sessionKey.trim()]),
    }),
    { name: 'stoclaw:session-unread' },
  ),
);
