/**
 * Resolve agentId / Claude taskId from session keys (sync, no I/O).
 * Claude task keys do not embed agentId — callers must look up the task definition
 * or session.agentId metadata when extractAgentIdFromSessionKey returns null.
 */

export function extractAgentIdFromSessionKey(sessionKey: string): string | null {
  const trimmed = sessionKey.trim();
  if (!trimmed.startsWith('agent:')) return null;
  const parts = trimmed.split(':');
  const agentId = (parts[1] || '').trim();
  return agentId || null;
}

/** Sync fallback used when no task/session metadata is available. */
export function getAgentIdFromSessionKeyOrMain(sessionKey: string): string {
  return extractAgentIdFromSessionKey(sessionKey) || 'main';
}

export function parseClaudeTaskIdFromSessionKey(sessionKey: string): string | null {
  const trimmed = sessionKey.trim();
  if (trimmed.startsWith('claude-task-run:')) {
    const parts = trimmed.split(':');
    const taskId = (parts[1] || '').trim();
    return taskId || null;
  }
  if (trimmed.startsWith('claude-task:')) {
    const rest = trimmed.slice('claude-task:'.length);
    const taskId = (rest.split(':')[0] || '').trim();
    return taskId || null;
  }
  return null;
}

export function isTaskExecutionSessionKey(sessionKey: string): boolean {
  const trimmed = sessionKey.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('claude-task:') || trimmed.startsWith('claude-task-run:')) return true;
  if (!trimmed.startsWith('agent:')) return false;
  const parts = trimmed.split(':');
  if (parts.length >= 4 && parts[2] === 'cron') return true;
  if (parts.length === 5 && parts[2] === 'scheduled-task') return true;
  return false;
}
