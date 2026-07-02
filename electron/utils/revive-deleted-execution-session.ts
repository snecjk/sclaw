import { isSessionDeleted, unmarkSessionDeleted } from './scheduled-task-poller-store';
import { resetDatedExecutionArtifacts } from './reset-dated-execution-record';

function formatLocalYmd(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * After user deleted a dated execution record, the next run should reappear with only that run's content.
 */
export async function reviveDeletedExecutionSession(sessionKey: string): Promise<void> {
  const trimmed = sessionKey.trim();
  if (!trimmed) return;
  const wasDeleted = await isSessionDeleted(trimmed);
  if (!wasDeleted) return;
  await resetDatedExecutionArtifacts(trimmed);
  await unmarkSessionDeleted(trimmed);
}

export async function reviveCronDatedExecutionSession(
  jobId: string,
  agentId = 'main',
  date = formatLocalYmd(),
): Promise<void> {
  await reviveDeletedExecutionSession(`agent:${agentId}:cron:${jobId}:${date}`);
}

export async function reviveScheduledTaskAgentDatedExecutionSession(
  taskId: number,
  agentId = 'main',
  date = formatLocalYmd(),
): Promise<void> {
  await reviveDeletedExecutionSession(`agent:${agentId}:scheduled-task:${taskId}:${date}`);
}

export async function reviveClaudeTaskDatedExecutionSession(
  taskId: string,
  date = formatLocalYmd(),
): Promise<void> {
  await reviveDeletedExecutionSession(`claude-task:${taskId}:${date}`);
}
