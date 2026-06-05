import { CHAT_HISTORY_LIMIT } from '../../../shared/chat-config';

export interface CronSessionKeyParts {
  agentId: string;
  jobId: string;
  runSessionId?: string;
  date?: string;
}

export function parseCronSessionKey(sessionKey: string): CronSessionKeyParts | null {
  // New format: agent:{agentId}:cron:{jobId} or agent:{agentId}:cron:{jobId}:run:{runSessionId}
  // or agent:{agentId}:cron:{jobId}:{date} (YYYY-MM-DD)
  if (sessionKey.startsWith('agent:')) {
    const parts = sessionKey.split(':');
    if (parts.length >= 4 && parts[2] === 'cron') {
      const agentId = parts[1] || 'main';
      const jobId = parts[3];
      if (!jobId) return null;
      if (parts.length === 4) return { agentId, jobId };
      if (parts.length === 5) {
        const date = parts[4];
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return { agentId, jobId, date };
        }
        return { agentId, jobId };
      }
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

// ---------------------------------------------------------------------------
// Scheduled Task Agent Session Keys (e.g. agent:main:scheduled-task:1:2026-06-04)
// ---------------------------------------------------------------------------

export interface ScheduledTaskAgentSessionKeyParts {
  agentId: string;
  taskId: number;
  date: string; // YYYY-MM-DD
}

export function parseScheduledTaskAgentSessionKey(sessionKey: string): ScheduledTaskAgentSessionKeyParts | null {
  if (!sessionKey.startsWith('agent:')) return null;
  const parts = sessionKey.split(':');
  // agent:{agentId}:scheduled-task:{taskId}:{date}
  if (parts.length === 5 && parts[2] === 'scheduled-task') {
    const agentId = parts[1] || 'main';
    const taskId = Number(parts[3]);
    const date = parts[4];
    if (!Number.isNaN(taskId) && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { agentId, taskId, date };
    }
  }
  return null;
}

export function isScheduledTaskAgentSessionKey(sessionKey: string): boolean {
  return parseScheduledTaskAgentSessionKey(sessionKey) !== null;
}
