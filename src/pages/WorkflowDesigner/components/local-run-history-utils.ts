import type { LocalWorkflowRunSummary } from '@/lib/workflow-api';

export type LocalRunHistoryStatus = 'success' | 'failed' | 'cancelled' | 'interrupted' | 'running';

const STATUS_MAP: Record<string, LocalRunHistoryStatus> = {
  SUCCEEDED: 'success',
  COMPLETED: 'success',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  INTERRUPTED: 'interrupted',
};

export function resolveLocalRunHistoryStatus(status: string): LocalRunHistoryStatus {
  return STATUS_MAP[status.toUpperCase()] ?? 'running';
}

export function formatLocalRunTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '-';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

export function formatLocalRunDuration(run: LocalWorkflowRunSummary): string {
  if (!run.completedAt) return '进行中';
  const startedAt = new Date(run.startedAt).getTime();
  const completedAt = new Date(run.completedAt).getTime();
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt) return '-';
  const seconds = Math.floor((completedAt - startedAt) / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} 分 ${seconds % 60} 秒`;
}

/** Never expose the version-row primary key to users as a workflow version. */
export function formatLocalRunVersion(run: LocalWorkflowRunSummary): string {
  return run.workflowVersion == null || run.workflowVersion === '' ? '版本未知' : `v${run.workflowVersion}`;
}
