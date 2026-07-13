import {
  buildClaudeTaskDatedSessionKey,
  getClaudeTaskRunSessionAggregateKey,
  getCronRunSessionAggregateKey,
  parseClaudeScheduledTaskSessionKey,
  parseCronSessionKey,
  parseScheduledTaskAgentSessionKey,
} from '@/stores/chat/cron-session-utils';

function todayDateKey(): string {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function buildCronDatedSessionKey(agentId: string, jobId: string, date: string): string {
  return `agent:${agentId}:cron:${jobId}:${date}`;
}

type CronDayBucket = { agentId: string; jobId: string; date: string };
type ClaudeDayBucket = { taskId: string; date: string };
type ScheduledTaskDayBucket = { agentId: string; taskId: number; date: string };

function resolveCronDayBucket(
  sessionKey: string,
): CronDayBucket | null {
  const cronRunAggregate = getCronRunSessionAggregateKey(sessionKey);
  if (cronRunAggregate) {
    const parsed = parseCronSessionKey(cronRunAggregate);
    if (parsed?.date) {
      return { agentId: parsed.agentId, jobId: parsed.jobId, date: parsed.date };
    }
  }

  const cron = parseCronSessionKey(sessionKey);
  if (!cron?.jobId) return null;

  if (cron.date) {
    return { agentId: cron.agentId, jobId: cron.jobId, date: cron.date };
  }

  return {
    agentId: cron.agentId,
    jobId: cron.jobId,
    date: todayDateKey(),
  };
}

function resolveClaudeDayBucket(sessionKey: string): ClaudeDayBucket | null {
  const claudeRunAggregate = getClaudeTaskRunSessionAggregateKey(sessionKey);
  if (claudeRunAggregate) {
    const parsed = parseClaudeScheduledTaskSessionKey(claudeRunAggregate);
    if (parsed?.date) {
      return { taskId: parsed.taskId, date: parsed.date };
    }
  }

  const claude = parseClaudeScheduledTaskSessionKey(sessionKey);
  if (!claude?.taskId) return null;

  return {
    taskId: claude.taskId,
    date: claude.date ?? todayDateKey(),
  };
}

function resolveScheduledTaskDayBucket(sessionKey: string): ScheduledTaskDayBucket | null {
  const scheduled = parseScheduledTaskAgentSessionKey(sessionKey);
  if (!scheduled) return null;
  return scheduled;
}

function cronDayBucketAliases(bucket: CronDayBucket): string[] {
  const aliases = new Set<string>();
  aliases.add(buildCronDatedSessionKey(bucket.agentId, bucket.jobId, bucket.date));
  // Legacy base key only belongs to today's sidebar row.
  if (bucket.date === todayDateKey()) {
    aliases.add(`agent:${bucket.agentId}:cron:${bucket.jobId}`);
  }
  return [...aliases];
}

function claudeDayBucketAliases(bucket: ClaudeDayBucket): string[] {
  const aliases = new Set<string>();
  aliases.add(buildClaudeTaskDatedSessionKey(bucket.taskId, bucket.date));
  if (bucket.date === todayDateKey()) {
    aliases.add(`claude-task:${bucket.taskId}`);
  }
  return [...aliases];
}

function scheduledTaskDayBucketAliases(bucket: ScheduledTaskDayBucket): string[] {
  return [`agent:${bucket.agentId}:scheduled-task:${bucket.taskId}:${bucket.date}`];
}

/** Pick the sidebar-visible dated key used for unread storage/display. */
export function canonicalSessionUnreadKey(sessionKey: string): string {
  const trimmed = sessionKey.trim();
  if (!trimmed) return trimmed;

  const cronBucket = resolveCronDayBucket(trimmed);
  if (cronBucket) {
    return buildCronDatedSessionKey(cronBucket.agentId, cronBucket.jobId, cronBucket.date);
  }

  const claudeBucket = resolveClaudeDayBucket(trimmed);
  if (claudeBucket) {
    return buildClaudeTaskDatedSessionKey(claudeBucket.taskId, claudeBucket.date);
  }

  const scheduledBucket = resolveScheduledTaskDayBucket(trimmed);
  if (scheduledBucket) {
    return `agent:${scheduledBucket.agentId}:scheduled-task:${scheduledBucket.taskId}:${scheduledBucket.date}`;
  }

  return trimmed;
}

/** Keys treated as the same unread bucket — scoped to one sidebar day row. */
export function collectSessionUnreadAliases(sessionKey: string): string[] {
  const trimmed = sessionKey.trim();
  if (!trimmed) return [];

  const cronBucket = resolveCronDayBucket(trimmed);
  if (cronBucket) return cronDayBucketAliases(cronBucket);

  const claudeBucket = resolveClaudeDayBucket(trimmed);
  if (claudeBucket) return claudeDayBucketAliases(claudeBucket);

  const scheduledBucket = resolveScheduledTaskDayBucket(trimmed);
  if (scheduledBucket) return scheduledTaskDayBucketAliases(scheduledBucket);

  return [trimmed];
}

export function isSessionUnreadInStore(
  unreadKeys: Record<string, true>,
  sessionKey: string,
): boolean {
  return collectSessionUnreadAliases(sessionKey)
    .some((key) => Boolean(unreadKeys[key]));
}
