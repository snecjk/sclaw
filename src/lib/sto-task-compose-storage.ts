/** sessionStorage key: JSON `{ taskId, entryId, cardBase }` set before navigating to a task subitem for one-shot auto-compose. */
export const STO_TASK_PENDING_COMPOSE_KEY = 'sto-pending-compose';

/** @deprecated 任务子项已统一在首页对话；保留类型供旧深链兼容。 */
export const STO_TASK_SUBITEM_NAV_SCROLL_END = 'stoTaskSubitemScrollEnd' as const;

/** sessionStorage：复用已有子项进入首页后滚到底（一次性 `{ taskId, entryId }`）。 */
export const STO_TASK_SUBITEM_SCROLL_END_STORAGE_KEY = 'sto-subitem-scroll-end';

export type StoTaskSubitemLocationState = {
  [STO_TASK_SUBITEM_NAV_SCROLL_END]?: boolean;
};

export function setStoTaskSubitemScrollEndIntent(taskId: string, entryId: string): void {
  try {
    sessionStorage.setItem(
      STO_TASK_SUBITEM_SCROLL_END_STORAGE_KEY,
      JSON.stringify({ taskId, entryId }),
    );
  } catch {
    /* ignore quota */
  }
}

export function consumeStoTaskSubitemScrollEndIntent(
  taskId: string,
  entryId: string,
): boolean {
  try {
    const raw = sessionStorage.getItem(STO_TASK_SUBITEM_SCROLL_END_STORAGE_KEY);
    if (!raw) return false;
    const o = JSON.parse(raw) as { taskId?: string; entryId?: string };
    if (o.taskId !== taskId || o.entryId !== entryId) return false;
    sessionStorage.removeItem(STO_TASK_SUBITEM_SCROLL_END_STORAGE_KEY);
    return true;
  } catch {
    sessionStorage.removeItem(STO_TASK_SUBITEM_SCROLL_END_STORAGE_KEY);
    return false;
  }
}
