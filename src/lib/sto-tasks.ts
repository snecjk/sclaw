/**
 * STO 原型任务列表：稳定路由键（与 OpenSpec `home-task-list-surface` 一致）。
 */
export const STO_TASK_IDS = ['hq-reconciliation', 'abnormal-customers', 'outbound-cost'] as const;

export type StoTaskId = (typeof STO_TASK_IDS)[number];

export function isStoTaskId(id: string): id is StoTaskId {
  return (STO_TASK_IDS as readonly string[]).includes(id);
}

export function taskDetailPath(id: StoTaskId): string {
  return `/tasks/${id}`;
}
