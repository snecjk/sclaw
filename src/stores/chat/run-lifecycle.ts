import type { SessionRuntimeState } from './types';
import { clearSessionRuntimeTimers } from './runtime-timers';
import { logChatFlow } from './chat-flow-log';

const MAX_TERMINAL_RUNS_PER_SESSION = 32;
const terminalRunsBySession = new Map<string, string[]>();

export interface RunEventDecision {
  accept: boolean;
  bindRun: boolean;
  reason?: 'terminal' | 'different-active-run' | 'orphan-event' | 'reopened';
}

export function decideRunEvent(input: {
  sessionKey: string;
  runtime: SessionRuntimeState;
  resolvedState: string;
  runId: string;
}): RunEventDecision {
  const { resolvedState, runId, runtime, sessionKey } = input;
  if (!runId) {
    return runtime.sending
      ? { accept: true, bindRun: false }
      : { accept: false, bindRun: false, reason: 'orphan-event' };
  }

  if (terminalRunsBySession.get(sessionKey)?.includes(runId)) {
    // A 'started' for an already-terminal runId means the gateway restarted the
    // run with the SAME runId (e.g. OpenClaw transient-error retry reuses the
    // runId). Reopen it instead of rejecting — otherwise the retry's
    // started/delta/final are all dropped and the session stays stuck in the
    // stale error state (persistent red banner). A truly-dead run never
    // re-emits 'started', so reopening is safe.
    if (resolvedState === 'started') {
      evictTerminalRun(sessionKey, runId);
      logChatFlow('event.run.reopened', { sessionKey, runId });
      return { accept: true, bindRun: true, reason: 'reopened' };
    }
    return { accept: false, bindRun: false, reason: 'terminal' };
  }

  if (runtime.activeRunId) {
    return runtime.activeRunId === runId
      ? { accept: true, bindRun: false }
      : { accept: false, bindRun: false, reason: 'different-active-run' };
  }

  if (resolvedState === 'started') {
    return { accept: true, bindRun: true };
  }

  if (runtime.sendAcceptance?.status === 'pending' || runtime.sendAcceptance?.status === 'uncertain') {
    return { accept: true, bindRun: true };
  }

  return { accept: false, bindRun: false, reason: 'orphan-event' };
}

export function recordTerminalRun(sessionKey: string, runId: string | null | undefined): void {
  if (!runId) return;
  clearSessionRuntimeTimers(sessionKey);
  const current = terminalRunsBySession.get(sessionKey) ?? [];
  if (current.includes(runId)) return;
  terminalRunsBySession.set(
    sessionKey,
    [...current, runId].slice(-MAX_TERMINAL_RUNS_PER_SESSION),
  );
}

export function evictTerminalRun(sessionKey: string, runId: string): void {
  const current = terminalRunsBySession.get(sessionKey);
  if (!current || !current.includes(runId)) return;
  const next = current.filter((id) => id !== runId);
  if (next.length === 0) {
    terminalRunsBySession.delete(sessionKey);
  } else {
    terminalRunsBySession.set(sessionKey, next);
  }
}

export function clearSessionRunLifecycle(sessionKey: string): void {
  terminalRunsBySession.delete(sessionKey);
}

export function isTerminalRun(sessionKey: string, runId: string): boolean {
  return terminalRunsBySession.get(sessionKey)?.includes(runId) ?? false;
}
