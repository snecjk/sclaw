import {
  getClaudeTaskRunSessionAggregateKey,
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

  if (!currentSessionKey) return eventSessionKey;

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
