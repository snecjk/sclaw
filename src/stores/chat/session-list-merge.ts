import {
  isVirtualTaskSessionKey,
  parseCronSessionKey,
  parseScheduledTaskSessionKey,
  parseScheduledTaskAgentSessionKey,
  parseClaudeScheduledTaskSessionKey,
  parseClaudeScheduledTaskRunSessionKey,
} from '@/stores/chat/cron-session-utils';

export type SessionListEntry = {
  key: string;
  label?: string;
  displayName?: string;
  engineType?: 'claude' | 'openclaw';
  model?: string;
  updatedAt?: number;
};

/**
 * Keep locally-known virtual task/cron sessions until the backend list materializes them.
 * Without this, switching away from a freshly triggered run drops the session from the
 * sidebar because loadSessions only appended the *current* key before.
 *
 * A base key (e.g. `agent:main:cron:{jobId}` or `claude-task:{taskId}`) or a run key
 * (`…:run:{runId}` / `claude-task-run:…`) represents a more granular view.  Once the
 * daily-aggregate session (`…:{date}`) has materialized on the backend, keeping both in
 * the sidebar would show two same-named entries until a full reload collapses them.
 *
 * This function mirrors the "dated supersedes base/run" dedup that loadSessions applies
 * to the remote list (chat.ts:1287–1324): build sets of jobs/tasks that already have
 * dated aggregates remotely, then suppress any pending local key whose job/task is in
 * those sets.
 */
export function appendPendingLocalVirtualTaskSessions<T extends SessionListEntry>(
  remoteSessions: T[],
  localSessions: T[],
  deletedKeys: ReadonlySet<string>,
): T[] {
  // ── Build sets of jobs/tasks that already have dated aggregate sessions remotely ──
  const cronDatedJobs = new Set<string>();
  const scheduledTaskDatedIds = new Set<number>();
  const claudeTaskDatedIds = new Set<string>();

  for (const session of remoteSessions) {
    const cronParts = parseCronSessionKey(session.key);
    if (cronParts?.date) cronDatedJobs.add(cronParts.jobId);

    const stAgentParts = parseScheduledTaskAgentSessionKey(session.key);
    if (stAgentParts?.date) scheduledTaskDatedIds.add(stAgentParts.taskId);

    const claudeParts = parseClaudeScheduledTaskSessionKey(session.key);
    if (claudeParts?.date) claudeTaskDatedIds.add(claudeParts.taskId);
  }

  const remoteKeySet = new Set(remoteSessions.map((session) => session.key));

  const pending = localSessions.filter((session) => {
    if (remoteKeySet.has(session.key) || deletedKeys.has(session.key)) return false;
    if (!isVirtualTaskSessionKey(session.key)) return false;

    // ── Cron: base & run keys are superseded by any dated aggregate ──
    const cronParts = parseCronSessionKey(session.key);
    if (cronParts && !cronParts.date && cronDatedJobs.has(cronParts.jobId)) return false;

    // ── Scheduled-task (STO): base key is superseded by any dated agent aggregate ──
    const stParts = parseScheduledTaskSessionKey(session.key);
    if (stParts && scheduledTaskDatedIds.has(stParts.taskId)) return false;

    // ── Claude-task: base & run keys are superseded by any dated aggregate ──
    const claudeParts = parseClaudeScheduledTaskSessionKey(session.key);
    if (claudeParts && !claudeParts.date && claudeTaskDatedIds.has(claudeParts.taskId)) return false;

    const claudeRunParts = parseClaudeScheduledTaskRunSessionKey(session.key);
    if (claudeRunParts && claudeTaskDatedIds.has(claudeRunParts.taskId)) return false;

    return true;
  });

  if (pending.length === 0) return remoteSessions;
  return [...remoteSessions, ...pending];
}
