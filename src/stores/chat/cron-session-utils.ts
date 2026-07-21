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
  const parsed = parseCronSessionKey(sessionKey);
  return parsed != null && parsed.date == null && parsed.runSessionId == null;
}

export function isCronDatedSessionKey(sessionKey: string): boolean {
  const parsed = parseCronSessionKey(sessionKey);
  return parsed?.date != null;
}

export function isCronRunSessionKey(sessionKey: string): boolean {
  const parsed = parseCronSessionKey(sessionKey);
  return parsed?.runSessionId != null;
}

/**
 * Check if a session key is any cron-related key (base, dated, or run).
 * Used for sidebar filtering where all cron keys belong in the task list section.
 */
export function isAnyCronSessionKey(sessionKey: string): boolean {
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
// Claude Scheduled Task Session Keys
// ---------------------------------------------------------------------------

export interface ClaudeScheduledTaskSessionKeyParts {
  taskId: string;
  date?: string; // YYYY-MM-DD for dated aggregate sessions
}

export function parseClaudeScheduledTaskSessionKey(sessionKey: string): ClaudeScheduledTaskSessionKeyParts | null {
  if (!sessionKey.startsWith('claude-task:')) return null;
  const rest = sessionKey.slice('claude-task:'.length);
  const parts = rest.split(':');
  // claude-task:{taskId} (base)
  if (parts.length === 1) {
    const taskId = parts[0]?.trim();
    if (!taskId) return null;
    return { taskId };
  }
  // claude-task:{taskId}:{YYYY-MM-DD} (dated aggregate)
  if (parts.length === 2) {
    const taskId = parts[0]?.trim();
    const date = parts[1]?.trim();
    if (!taskId) return null;
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { taskId, date };
    }
    // Non-date second segment — treat as base key
    return { taskId };
  }
  return null;
}

export function isClaudeScheduledTaskSessionKey(sessionKey: string): boolean {
  return parseClaudeScheduledTaskSessionKey(sessionKey) != null;
}

export function isClaudeScheduledTaskDatedSessionKey(sessionKey: string): boolean {
  const parsed = parseClaudeScheduledTaskSessionKey(sessionKey);
  return parsed?.date != null;
}

export function buildClaudeTaskDatedSessionKey(taskId: string, date: string): string {
  return `claude-task:${taskId}:${date}`;
}

export function buildClaudeScheduledTaskSessionHistoryPath(sessionKey: string, limit = CHAT_HISTORY_LIMIT): string {
  const params = new URLSearchParams({ sessionKey });
  if (Number.isFinite(limit) && limit > 0) {
    params.set('limit', String(Math.floor(limit)));
  }
  return `/api/claude-scheduled-tasks/session-history?${params.toString()}`;
}

export interface ClaudeScheduledTaskRunSessionKeyParts {
  taskId: string;
  runId: string;
}

export function parseClaudeScheduledTaskRunSessionKey(sessionKey: string): ClaudeScheduledTaskRunSessionKeyParts | null {
  if (!sessionKey.startsWith('claude-task-run:')) return null;
  const parts = sessionKey.split(':');
  if (parts.length !== 3) return null;
  const taskId = parts[1]?.trim();
  const runId = parts[2]?.trim();
  if (!taskId || !runId) return null;
  return { taskId, runId };
}

export function isClaudeScheduledTaskRunSessionKey(sessionKey: string): boolean {
  return parseClaudeScheduledTaskRunSessionKey(sessionKey) != null;
}

/**
 * True for "virtual" task/cron session keys that loadHistory resolves by key
 * prefix — they may be absent from the backend sessions list right after a task
 * is triggered, because the run transcript is materialized asynchronously.
 * loadSessions must not reset `currentSessionKey` away from these, or the
 * composer falls back to the default agent's engine instead of the triggered
 * task's engine.
 */
export function isVirtualTaskSessionKey(sessionKey: string): boolean {
  return (
    isAnyCronSessionKey(sessionKey)
    || isClaudeScheduledTaskSessionKey(sessionKey)
    || isClaudeScheduledTaskRunSessionKey(sessionKey)
  );
}

// ---------------------------------------------------------------------------
// Cron Run Session → Daily Aggregate Key Mapping
// ---------------------------------------------------------------------------

/**
 * Maps a cron run session key to its corresponding daily aggregate session key.
 * e.g. `agent:main:cron:job-123:run:abc-def` → `agent:main:cron:job-123:2026-06-21`
 * Returns null if the input is not a cron run session key.
 */
export function getCronRunSessionAggregateKey(runSessionKey: string): string | null {
  const parsed = parseCronSessionKey(runSessionKey);
  if (!parsed?.runSessionId) return null;
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return `agent:${parsed.agentId}:cron:${parsed.jobId}:${y}-${m}-${d}`;
}

// ---------------------------------------------------------------------------
// Claude Task Run Session → Daily Aggregate Key Mapping
// ---------------------------------------------------------------------------

/**
 * Maps a Claude task run session key to its corresponding daily aggregate session key.
 * e.g. `claude-task-run:abc-123:def-456` → `claude-task:abc-123:2026-06-25`
 * Returns null if the input is not a Claude task run session key.
 */
export function getClaudeTaskRunSessionAggregateKey(runSessionKey: string): string | null {
  const parsed = parseClaudeScheduledTaskRunSessionKey(runSessionKey);
  if (!parsed) return null;
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return `claude-task:${parsed.taskId}:${y}-${m}-${d}`;
}

