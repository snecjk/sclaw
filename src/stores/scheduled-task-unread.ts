/**
 * Scheduled Task Unread Store
 *
 * Tracks unread scheduled task execution results for the Sidebar red dot badge.
 * Reset on app restart (no persistence needed — user can see results in sessions).
 */

import { create } from 'zustand';

interface ScheduledTaskUnreadState {
  unreadTaskIds: Set<number>;
  addUnread: (taskId: number) => void;
  markRead: (taskId: number) => void;
  markAllRead: () => void;
  hasUnread: () => boolean;
}

export const useScheduledTaskUnreadStore = create<ScheduledTaskUnreadState>((set, get) => ({
  unreadTaskIds: new Set(),

  addUnread: (taskId) =>
    set((state) => {
      const next = new Set(state.unreadTaskIds);
      next.add(taskId);
      return { unreadTaskIds: next };
    }),

  markRead: (taskId) =>
    set((state) => {
      const next = new Set(state.unreadTaskIds);
      next.delete(taskId);
      return { unreadTaskIds: next };
    }),

  markAllRead: () => set({ unreadTaskIds: new Set() }),

  hasUnread: () => get().unreadTaskIds.size > 0,
}));
