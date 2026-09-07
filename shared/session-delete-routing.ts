/** Task execution records stored under OpenClaw agents/cron paths — never Claude SDK sessions. */
export function isOpenClawHostedTaskExecutionSessionKey(sessionKey: string): boolean {
  if (!sessionKey.startsWith('agent:')) return false;
  const parts = sessionKey.split(':');
  if (parts.length >= 4 && parts[2] === 'cron') return true;
  if (parts.length === 5 && parts[2] === 'scheduled-task') return true;
  if (sessionKey.startsWith('agent:main:sto-')) return true;
  if (sessionKey.startsWith('agent:main:session-sto-')) return true;
  return false;
}

export function isClaudeTaskExecutionSessionKey(sessionKey: string): boolean {
  return sessionKey.startsWith('claude-task:') || sessionKey.startsWith('claude-task-run:');
}

/** Session keys eligible for POST /api/sessions/model (in-session model override). */
export function isSessionModelSwitchKey(sessionKey: string): boolean {
  const trimmed = sessionKey.trim();
  if (!trimmed) return false;
  return trimmed.startsWith('agent:')
    || trimmed.startsWith('pi:')
    || trimmed.startsWith('pi-task:')
    || isClaudeTaskExecutionSessionKey(trimmed);
}
