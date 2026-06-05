import { matchPath } from 'react-router-dom';
import { STO_TASK_IDS, type StoTaskId } from '@/lib/sto-tasks';

const ENTRY_YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Stable OpenClaw session key for a STO task subitem (chat-only surface).
 * Shape: `agent:main:sto-<taskId>-<YYYY-MM-DD>` — taskId may contain hyphens; entryId is always last segment after taskId prefix.
 */
export function stoTaskSessionKey(taskId: StoTaskId, entryId: string): string {
  return `agent:main:sto-${taskId}-${entryId}`;
}

export function isStoTaskSessionKey(sessionKey: string): boolean {
  return parseStoTaskSessionKey(sessionKey) !== null;
}

/** Subitem chat sessions: legacy `sto-*` keys or per-subitem UUID-backed `session-sto-*` keys — hide from the normal chat session list. */
export function isHiddenStoTaskSubitemChatSessionKey(sessionKey: string): boolean {
  return isStoTaskSessionKey(sessionKey) || sessionKey.startsWith('agent:main:session-sto-');
}

/** Per-agent main session (`agent:<id>:main`) — used internally, not listed in the chat sidebar. */
export function isMainAgentChatSessionKey(sessionKey: string): boolean {
  return sessionKey.endsWith(':main');
}

/** Scheduled-task summary session (e.g. scheduled-task:1) — hidden because per-run agent sessions are shown instead. */
export function isScheduledTaskSummarySessionKey(sessionKey: string): boolean {
  if (!sessionKey.startsWith('scheduled-task:')) return false;
  const rest = sessionKey.slice('scheduled-task:'.length);
  return /^\d+$/.test(rest);
}

/** Sessions that must not appear as rows in the chat sidebar session list. */
export function isSidebarHiddenChatSessionKey(sessionKey: string): boolean {
  return (
    isHiddenStoTaskSubitemChatSessionKey(sessionKey) ||
    isMainAgentChatSessionKey(sessionKey) ||
    isScheduledTaskSummarySessionKey(sessionKey)
  );
}

/** True when user left a task subitem route but the store still points at its hidden session. */
export function shouldRestoreMainSessionLeavingTaskSubitem(
  pathname: string,
  currentSessionKey: string,
): boolean {
  const onSubitem = matchPath({ path: '/tasks/:taskId/:entryId', end: true }, pathname);
  if (onSubitem) return false;
  return isHiddenStoTaskSubitemChatSessionKey(currentSessionKey);
}

export function parseStoTaskSessionKey(sessionKey: string): { taskId: StoTaskId; entryId: string } | null {
  if (!sessionKey.startsWith('agent:main:sto-')) return null;
  const rest = sessionKey.slice('agent:main:sto-'.length);
  for (const id of STO_TASK_IDS) {
    const prefix = `${id}-`;
    if (rest.startsWith(prefix)) {
      const entryId = rest.slice(prefix.length);
      if (ENTRY_YMD.test(entryId)) return { taskId: id, entryId };
    }
  }
  return null;
}
