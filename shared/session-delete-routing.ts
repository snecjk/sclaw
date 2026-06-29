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
