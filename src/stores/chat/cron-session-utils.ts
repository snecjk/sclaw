import { CHAT_HISTORY_LIMIT } from '../../../shared/chat-config';

export interface CronSessionKeyParts {
  agentId: string;
  jobId: string;
  runSessionId?: string;
}

export function parseCronSessionKey(sessionKey: string): CronSessionKeyParts | null {
  // New format: agent:{agentId}:cron:{jobId} or agent:{agentId}:cron:{jobId}:run:{runSessionId}
  if (sessionKey.startsWith('agent:')) {
    const parts = sessionKey.split(':');
    if (parts.length >= 4 && parts[2] === 'cron') {
      const agentId = parts[1] || 'main';
      const jobId = parts[3];
      if (!jobId) return null;
      if (parts.length === 4) return { agentId, jobId };
      if (parts.length === 6 && parts[4] === 'run' && parts[5]) {
        return { agentId, jobId, runSessionId: parts[5] };
      }
      return { agentId, jobId };
    }
  }

  // Legacy format: [cron:{jobId}] or cron:{jobId}
  const legacyMatch = sessionKey.match(/^\[?cron:([^\]]+)\]?$/);
  if (legacyMatch) {
    const jobId = legacyMatch[1];
    if (jobId) return { agentId: 'main', jobId };
  }

  return null;
}

export function isCronSessionKey(sessionKey: string): boolean {
  return parseCronSessionKey(sessionKey) != null;
}

export function buildCronSessionHistoryPath(sessionKey: string, limit = CHAT_HISTORY_LIMIT): string {
  const params = new URLSearchParams({ sessionKey });
  if (Number.isFinite(limit) && limit > 0) {
    params.set('limit', String(Math.floor(limit)));
  }
  return `/api/cron/session-history?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Scheduled Task Session Keys
// ---------------------------------------------------------------------------

export interface ScheduledTaskSessionKeyParts {
  taskId: number;
}

export function parseScheduledTaskSessionKey(sessionKey: string): ScheduledTaskSessionKeyParts | null {
  if (!sessionKey.startsWith('scheduled-task:')) return null;
  const taskIdStr = sessionKey.slice('scheduled-task:'.length);
  const taskId = Number(taskIdStr);
  if (Number.isNaN(taskId)) return null;
  return { taskId };
}

export function isScheduledTaskSessionKey(sessionKey: string): boolean {
  return parseScheduledTaskSessionKey(sessionKey) != null;
}

export function buildScheduledTaskSessionHistoryPath(sessionKey: string, limit = CHAT_HISTORY_LIMIT): string {
  const params = new URLSearchParams({ sessionKey });
  if (Number.isFinite(limit) && limit > 0) {
    params.set('limit', String(Math.floor(limit)));
  }
  return `/api/scheduled-tasks/session-history?${params.toString()}`;
}
