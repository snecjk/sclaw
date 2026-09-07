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

// ---------------------------------------------------------------------------
// PI Scheduled Task Session Keys
// ---------------------------------------------------------------------------

export interface PiScheduledTaskSessionKeyParts {
  taskId: string;
  date?: string;
}

/** PI scheduled-task key: `pi-task:{taskId}` or `pi-task:{taskId}:{YYYY-MM-DD}`. */
export function parsePiScheduledTaskSessionKey(
  sessionKey: string,
): PiScheduledTaskSessionKeyParts | null {
  const trimmed = sessionKey.trim();
  if (!trimmed.startsWith('pi-task:')) return null;
  const parts = trimmed.split(':');
  if (parts.length !== 2 && parts.length !== 3) return null;
  const taskId = parts[1]?.trim();
  if (!taskId) return null;
  if (parts.length === 2) return { taskId };
  const date = parts[2]?.trim();
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { taskId, date } : null;
}

export function isPiScheduledTaskDatedSessionKey(sessionKey: string): boolean {
  return parsePiScheduledTaskSessionKey(sessionKey)?.date != null;
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
  const trimmed = sessionKey.trim();
  return (
    isAnyCronSessionKey(trimmed)
    || isClaudeScheduledTaskSessionKey(trimmed)
    || isClaudeScheduledTaskRunSessionKey(trimmed)
    || parsePiScheduledTaskSessionKey(trimmed) != null
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

/**
 * Maps a cron BASE key (`agent:{a}:cron:{job}` — no date, no run) to today's
 * dated aggregate key. The OpenClaw Gateway emits a base key for `delta`/
 * `final` events while `started` carries a dated key; without normalization the
 * background handler sees the base key as an orphan session and drops the
 * stream, leaving the dated session stuck in `sending` with no unread badge.
 * Mirrors `getCronRunSessionAggregateKey` but acts on base keys.
 */
export function getCronBaseSessionTodayDatedKey(sessionKey: string): string | null {
  const parsed = parseCronSessionKey(sessionKey);
  if (!parsed || parsed.date || parsed.runSessionId) return null;
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

/**
 * Maps a Claude task BASE key (`claude-task:{taskId}` — no date) to today's
 * dated aggregate key. Symmetric to {@link getCronBaseSessionTodayDatedKey};
 * ensures any base-key event emitted by the Claude worker routes to today's
 * dated session instead of leaking into a viewed yesterday-dated session.
 */
export function getClaudeTaskBaseSessionTodayDatedKey(sessionKey: string): string | null {
  const parsed = parseClaudeScheduledTaskSessionKey(sessionKey);
  if (!parsed || parsed.date) return null;
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return `claude-task:${parsed.taskId}:${y}-${m}-${d}`;
}

