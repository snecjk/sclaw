import {
  getClaudeTaskBaseSessionTodayDatedKey,
  getClaudeTaskRunSessionAggregateKey,
  getCronBaseSessionTodayDatedKey,
  getCronRunSessionAggregateKey,
  parseClaudeScheduledTaskSessionKey,
  parseCronSessionKey,
} from './cron-session-utils';

export function mapEventSessionKey(input: {
  eventSessionKey: string | null;
  currentSessionKey: string | null;
}): string | null {
  const { eventSessionKey, currentSessionKey } = input;
  if (!eventSessionKey) return null;

  const aggregateKey = getCronRunSessionAggregateKey(eventSessionKey)
    ?? getClaudeTaskRunSessionAggregateKey(eventSessionKey);
  if (aggregateKey) return aggregateKey;

  // Normalize cron/claude BASE keys (no date, no run) to today's dated
  // aggregate. The OpenClaw Gateway emits a base key for `delta`/`final`
  // while `started` carries a dated key; this keeps the whole run on a single
  // dated session so the background handler never sees it as an orphan.
  // It also prevents a viewed yesterday-dated session from capturing today's
  // run content.
  const baseAggregateKey = getCronBaseSessionTodayDatedKey(eventSessionKey)
    ?? getClaudeTaskBaseSessionTodayDatedKey(eventSessionKey);
  if (baseAggregateKey) return baseAggregateKey;

  if (!currentSessionKey) return eventSessionKey;

  // Legacy fallback: if a base key somehow escapes normalization above, route
  // it to a currently-viewed dated session of the same job/task. Kept as a
  // safety net; the today-dated mapping above is the primary path.
  const cronParsed = parseCronSessionKey(eventSessionKey);
  if (cronParsed && !cronParsed.date && !cronParsed.runSessionId) {
    const currentCronParsed = parseCronSessionKey(currentSessionKey);
    if (
      currentCronParsed?.date
      && currentCronParsed.jobId === cronParsed.jobId
    ) {
      return currentSessionKey;
    }
  }

  const claudeParsed = parseClaudeScheduledTaskSessionKey(eventSessionKey);
  if (claudeParsed && !claudeParsed.date) {
    const currentClaudeParsed = parseClaudeScheduledTaskSessionKey(currentSessionKey);
    if (
      currentClaudeParsed?.date
      && currentClaudeParsed.taskId === claudeParsed.taskId
    ) {
      return currentSessionKey;
    }
  }

  return eventSessionKey;
}
