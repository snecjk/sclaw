import { isBridgeAiChatSessionKey } from './bridge-ai-session';
import { isEmbedAppChatSessionKey } from './session-type';
import { isWorkflowOpenClawSessionKey } from './workflow-openclaw-session';

const DATE_SUFFIX = /^\d{4}-\d{2}-\d{2}$/;

function isHiddenStoTaskSubitemChatSessionKey(sessionKey: string): boolean {
  return sessionKey.startsWith('agent:main:sto-')
    || sessionKey.startsWith('agent:main:session-sto-');
}

function isMainAgentChatSessionKey(sessionKey: string): boolean {
  return sessionKey.endsWith(':main');
}

function isClaudeScheduledTaskSummarySessionKey(sessionKey: string): boolean {
  if (!sessionKey.startsWith('claude-task:')) return false;
  const parts = sessionKey.slice('claude-task:'.length).split(':');
  if (parts.length === 1) return Boolean(parts[0]?.trim());
  if (parts.length === 2) return !DATE_SUFFIX.test(parts[1] ?? '');
  return false;
}

function isCronRunSessionKey(sessionKey: string): boolean {
  return /^agent:[^:]+:cron:[^:]+:run:[^:]+$/.test(sessionKey);
}

/** Pure cross-process contract for rows that must stay out of the chat sidebar. */
export function isSidebarHiddenChatSessionKey(sessionKey: string): boolean {
  const key = sessionKey.trim();
  if (!key) return true;
  return (
    isHiddenStoTaskSubitemChatSessionKey(key)
    || isMainAgentChatSessionKey(key)
    || isEmbedAppChatSessionKey(key)
    || isBridgeAiChatSessionKey(key)
    || isClaudeScheduledTaskSummarySessionKey(key)
    || isCronRunSessionKey(key)
    || isWorkflowOpenClawSessionKey(key)
  );
}

export function isSidebarVisibleChatSessionKey(sessionKey: string): boolean {
  const key = sessionKey.trim();
  if (isSidebarHiddenChatSessionKey(key)) return false;
  if (key.startsWith('claude-task-run:')) return false;
  if (key.startsWith('claude-task:')) {
    return /^claude-task:[^:]+:\d{4}-\d{2}-\d{2}$/.test(key);
  }
  if (/^\[?cron:/.test(key) || /^agent:[^:]+:cron:/.test(key)) {
    return /^agent:[^:]+:cron:[^:]+:\d{4}-\d{2}-\d{2}$/.test(key);
  }
  return true;
}
