import { hostApiFetch } from '@/lib/host-api';
import {
  buildClaudeScheduledTaskSessionHistoryPath,
  buildCronSessionHistoryPath,
  isClaudeScheduledTaskDatedSessionKey,
  isClaudeScheduledTaskRunSessionKey,
  isClaudeScheduledTaskSessionKey,
  isCronDatedSessionKey,
  isCronSessionKey,
} from './cron-session-utils';
import type { RawMessage } from './types';

export async function loadCronFallbackMessages(sessionKey: string, limit: number): Promise<RawMessage[]> {
  if (!isCronSessionKey(sessionKey) && !isCronDatedSessionKey(sessionKey)) return [];
  return loadFallback(buildCronSessionHistoryPath(sessionKey, limit), 'cron');
}

export async function loadClaudeScheduledTaskFallbackMessages(
  sessionKey: string,
  limit: number,
): Promise<RawMessage[]> {
  if (!isClaudeScheduledTaskSessionKey(sessionKey)
    && !isClaudeScheduledTaskRunSessionKey(sessionKey)
    && !isClaudeScheduledTaskDatedSessionKey(sessionKey)) return [];
  return loadFallback(buildClaudeScheduledTaskSessionHistoryPath(sessionKey, limit), 'claude scheduled task');
}

export async function loadVirtualTaskFallbackMessages(sessionKey: string, limit: number): Promise<RawMessage[]> {
  if (isCronSessionKey(sessionKey) || isCronDatedSessionKey(sessionKey)) {
    return loadCronFallbackMessages(sessionKey, limit);
  }
  if (isClaudeScheduledTaskSessionKey(sessionKey)
    || isClaudeScheduledTaskRunSessionKey(sessionKey)
    || isClaudeScheduledTaskDatedSessionKey(sessionKey)) {
    return loadClaudeScheduledTaskFallbackMessages(sessionKey, limit);
  }
  return [];
}

async function loadFallback(path: string, source: string): Promise<RawMessage[]> {
  try {
    const response = await hostApiFetch<{ messages?: RawMessage[] }>(path);
    return Array.isArray(response.messages) ? response.messages : [];
  } catch (error) {
    console.warn(`Failed to load ${source} fallback history:`, error);
    return [];
  }
}
