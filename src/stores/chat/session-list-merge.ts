import { preferCronDatedSessionKey } from '../../../shared/cron-job-agent';
import {
  isVirtualTaskSessionKey,
  parseCronSessionKey,
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
  const cronDatedJobDates = new Set<string>();
  const claudeTaskDatedIds = new Set<string>();

  for (const session of remoteSessions) {
    const cronParts = parseCronSessionKey(session.key);
    if (cronParts?.date) {
      cronDatedJobs.add(cronParts.jobId);
      cronDatedJobDates.add(`${cronParts.jobId}:${cronParts.date}`);
    }

    const claudeParts = parseClaudeScheduledTaskSessionKey(session.key);
    if (claudeParts?.date) claudeTaskDatedIds.add(claudeParts.taskId);
  }

  const remoteKeySet = new Set(remoteSessions.map((session) => session.key));

  const pending = localSessions.filter((session) => {
    if (remoteKeySet.has(session.key) || deletedKeys.has(session.key)) return false;
    if (!isVirtualTaskSessionKey(session.key)) return false;

    // ── Cron: base & run keys are superseded by any dated aggregate ──
    const cronParts = parseCronSessionKey(session.key);
    // Dated twin under a different agentId (UI ops vs host main) — do not append.
    if (
      cronParts?.date
      && cronDatedJobDates.has(`${cronParts.jobId}:${cronParts.date}`)
    ) {
      return false;
    }
    if (cronParts && !cronParts.date && cronDatedJobs.has(cronParts.jobId)) return false;

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

/**
 * When the same cron job+date exists under both `main` and a non-main agent (legacy twin),
 * keep one key. Prefer `preferredKey` (current / activating) when present so trigger UX
 * does not show two same-day rows under the task group.
 */
export function omitSupersededCronDatedAgentTwins<T extends SessionListEntry>(
  sessions: T[],
  preferredKey?: string | null,
): T[] {
  const groups = new Map<string, string[]>();
  for (const session of sessions) {
    const cronParts = parseCronSessionKey(session.key);
    if (!cronParts?.date) continue;
    const groupKey = `${cronParts.jobId}:${cronParts.date}`;
    const list = groups.get(groupKey) ?? [];
    list.push(session.key);
    groups.set(groupKey, list);
  }

  const preferred = new Map<string, string>();
  for (const [groupKey, keys] of groups) {
    if (keys.length < 2) continue;
    const keep = preferCronDatedSessionKey(keys, preferredKey);
    if (keep) preferred.set(groupKey, keep);
  }
  if (preferred.size === 0) return sessions;

  return sessions.filter((session) => {
    const cronParts = parseCronSessionKey(session.key);
    if (!cronParts?.date) return true;
    const keep = preferred.get(`${cronParts.jobId}:${cronParts.date}`);
    return !keep || keep === session.key;
  });
}

/** Resolve a cron dated twin already in the list for the same jobId+date (any agent). */
export function findCronDatedTwinKey(
  sessions: Array<{ key: string }>,
  sessionKey: string,
): string | undefined {
  const target = parseCronSessionKey(sessionKey);
  if (!target?.date) return undefined;
  return sessions.find((session) => {
    if (session.key === sessionKey) return false;
    const parts = parseCronSessionKey(session.key);
    return parts?.jobId === target.jobId && parts.date === target.date;
  })?.key;
}
