/**
 * STO 原型任务列表：稳定路由键与「主任务 → 子项（日期/周期）」条目（与 OpenSpec home-task-list-surface 一致）。
 */
export const STO_TASK_IDS = ['hq-reconciliation', 'abnormal-customers', 'outbound-cost'] as const;

export type StoTaskId = (typeof STO_TASK_IDS)[number];

/** 各主任务下子项 id（URL 段），顺序首条为「最新」 */
export const STO_TASK_ENTRIES: Record<StoTaskId, readonly string[]> = {
  'hq-reconciliation': ['2026-05-10', '2026-05-09'],
  'abnormal-customers': ['2026-05-10'],
  'outbound-cost': ['2026-05'],
};

export function isStoTaskId(id: string): id is StoTaskId {
  return (STO_TASK_IDS as readonly string[]).includes(id);
}

export function listTaskEntryIds(taskId: StoTaskId): readonly string[] {
  return STO_TASK_ENTRIES[taskId];
}

export function getLatestTaskEntryId(taskId: StoTaskId): string {
  const list = STO_TASK_ENTRIES[taskId];
  return list[0] ?? '';
}

export function isValidTaskEntry(taskId: StoTaskId, entryId: string): boolean {
  return (STO_TASK_ENTRIES[taskId] as readonly string[]).includes(entryId);
}

/** 指定子项详情页 */
export function taskDetailPath(taskId: StoTaskId, entryId: string): string {
  return `/tasks/${taskId}/${entryId}`;
}

/** 该主任务「最新一条」子项 */
export function taskLatestPath(taskId: StoTaskId): string {
  return taskDetailPath(taskId, getLatestTaskEntryId(taskId));
}
