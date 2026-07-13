/**
 * Sidebar delete confirmation — lightweight store so opening/closing the dialog
 * does not re-render the full Sidebar tree.
 */
import { create } from 'zustand';
import { toast } from 'sonner';
import i18n from '@/i18n';
import type { StoTaskId } from '@/lib/sto-tasks';

export type SidebarSessionDeletePayload = { key: string; label: string };

export type SidebarSubitemDeletePayload = {
  taskId: StoTaskId;
  entryId: string;
  label: string;
  sessionKey: string;
};

type DeleteExecutor = (payload: SidebarSessionDeletePayload) => Promise<boolean>;
type SubitemDeleteExecutor = (payload: SidebarSubitemDeletePayload) => Promise<boolean>;

interface SidebarDeleteConfirmState {
  sessionToDelete: SidebarSessionDeletePayload | null;
  subitemToDelete: SidebarSubitemDeletePayload | null;
  sessionDeleteExecutor: DeleteExecutor | null;
  subitemDeleteExecutor: SubitemDeleteExecutor | null;
  requestSessionDelete: (payload: SidebarSessionDeletePayload) => void;
  requestSubitemDelete: (payload: SidebarSubitemDeletePayload) => void;
  clearSessionDelete: () => void;
  clearSubitemDelete: () => void;
  registerExecutors: (executors: {
    deleteSession: DeleteExecutor;
    deleteSubitem: SubitemDeleteExecutor;
  }) => void;
}

export const useSidebarDeleteConfirmStore = create<SidebarDeleteConfirmState>((set) => ({
  sessionToDelete: null,
  subitemToDelete: null,
  sessionDeleteExecutor: null,
  subitemDeleteExecutor: null,

  requestSessionDelete: (payload) => set({ sessionToDelete: payload }),

  requestSubitemDelete: (payload) => set({ subitemToDelete: payload }),

  clearSessionDelete: () => set({ sessionToDelete: null }),

  clearSubitemDelete: () => set({ subitemToDelete: null }),

  registerExecutors: ({ deleteSession, deleteSubitem }) =>
    set({ sessionDeleteExecutor: deleteSession, subitemDeleteExecutor: deleteSubitem }),
}));

/** Await IPC delete; close dialog only after success (avoids optimistic remove + rollback flicker). */
export async function confirmSidebarSessionDelete(): Promise<void> {
  const { sessionToDelete, sessionDeleteExecutor, clearSessionDelete } =
    useSidebarDeleteConfirmStore.getState();
  if (!sessionToDelete || !sessionDeleteExecutor) return;
  const payload = sessionToDelete;
  const deleted = await sessionDeleteExecutor(payload);
  if (deleted) {
    clearSessionDelete();
    toast.success(i18n.t('common:sidebar.deleteSessionSucceeded'));
  }
}

export async function confirmSidebarSubitemDelete(): Promise<void> {
  const { subitemToDelete, subitemDeleteExecutor, clearSubitemDelete } =
    useSidebarDeleteConfirmStore.getState();
  if (!subitemToDelete || !subitemDeleteExecutor) return;
  const payload = subitemToDelete;
  const deleted = await subitemDeleteExecutor(payload);
  if (deleted) {
    clearSubitemDelete();
  }
}
