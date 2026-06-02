/**
 * STO 原型任务列表：稳定路由键与「主任务 → 子项（日期/周期）」条目（与 OpenSpec home-task-list-surface 一致）。
 */
export const STO_TASK_IDS = ['hq-reconciliation', 'weekly-ppt'] as const;

export type StoTaskId = (typeof STO_TASK_IDS)[number];

/** 各主任务下子项 id（URL 段），顺序首条为「最新」；空数组表示仅有总览路由 `/tasks/:taskId` */
export const STO_TASK_ENTRIES: Record<StoTaskId, readonly string[]> = {
  'hq-reconciliation': [],
  'weekly-ppt': [],
};

export function isStoTaskId(id: string): id is StoTaskId {
  return (STO_TASK_IDS as readonly string[]).includes(id);
}

export function listTaskEntryIds(taskId: StoTaskId): readonly string[] {
  return STO_TASK_ENTRIES[taskId];
}

export function taskHasSubEntries(taskId: StoTaskId): boolean {
  return STO_TASK_ENTRIES[taskId].length > 0;
}

export function getLatestTaskEntryId(taskId: StoTaskId): string {
  const list = STO_TASK_ENTRIES[taskId];
  return list[0] ?? '';
}

export function isValidTaskEntry(taskId: StoTaskId, entryId: string): boolean {
  return (STO_TASK_ENTRIES[taskId] as readonly string[]).includes(entryId);
}

/** `YYYY-MM-DD` (calendar date segment in routes). */
export function isYmdEntryId(entryId: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(entryId);
}

/** 主任务总览（无子项时使用） */
export function taskOverviewPath(taskId: StoTaskId): string {
  return `/tasks/${taskId}`;
}

/** 指定子项详情页 */
export function taskDetailPath(taskId: StoTaskId, entryId: string): string {
  return `/tasks/${taskId}/${entryId}`;
}

/** 该主任务「最新一条」子项；无子项时等同于 {@link taskOverviewPath} */
export function taskLatestPath(taskId: StoTaskId): string {
  const list = STO_TASK_ENTRIES[taskId];
  if (list.length === 0) return taskOverviewPath(taskId);
  return taskDetailPath(taskId, list[0]);
}
