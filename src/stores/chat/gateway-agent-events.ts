import { markSessionUnreadAfterSuccessfulRun } from '@/lib/session-unread-notify';
import { buildChatEventFromEngineEvent } from './gateway-event-normalization';
import { applyRuntimePatch } from './runtime-controller';
import { mapEventSessionKey } from './session-event-routing';
import { buildTerminalRuntimePatch } from './turn-state-machine';
import type { ChatState } from './types';
import { getSessionRuntimeState } from './session-runtime';
import { isTerminalRun } from './run-lifecycle';

const LOAD_SESSIONS_MIN_INTERVAL_MS = 1_200;
const LOAD_HISTORY_MIN_INTERVAL_MS = 800;
const COMPLETION_HISTORY_RELOAD_DELAYS_MS = [1_000, 3_000, 7_000];

let lastLoadSessionsAt = 0;
const lastLoadHistoryAtBySession = new Map<string, number>();

function maybeLoadSessions(
  state: { loadSessions: () => Promise<void> },
  force = false,
): void {
  const now = Date.now();
  if (!force && now - lastLoadSessionsAt < LOAD_SESSIONS_MIN_INTERVAL_MS) return;
  lastLoadSessionsAt = now;
  void state.loadSessions();
}

function maybeLoadHistory(
  state: {
    currentSessionKey: string;
    loadHistory: (quiet?: boolean, force?: boolean, sessionKey?: string) => Promise<void>;
  },
  force = false,
  sessionKey?: string | null,
): void {
  const targetSessionKey = sessionKey ?? state.currentSessionKey;
  const now = Date.now();
  const lastLoadAt = lastLoadHistoryAtBySession.get(targetSessionKey) ?? 0;
  if (!force && now - lastLoadAt < LOAD_HISTORY_MIN_INTERVAL_MS) return;
  lastLoadHistoryAtBySession.set(targetSessionKey, now);
  void state.loadHistory(true, force, targetSessionKey);
}

function eventString(value: unknown): string | null {
  return value != null ? String(value) : null;
}

export function shouldRefreshSessionList(input: {
  resolvedSessionKey: string | null;
  currentSessionKey: string;
  sessions: Array<{ key: string }>;
}): boolean {
  const { currentSessionKey, resolvedSessionKey, sessions } = input;
  return resolvedSessionKey != null && (
    resolvedSessionKey !== currentSessionKey
    || !sessions.some((session) => session.key === resolvedSessionKey)
  );
}

export function shouldFinalizeCompletedRun(input: {
  runId: unknown;
  resolvedSessionKey: string | null;
  state: Pick<
    ChatState,
    'activeRunId' | 'currentSessionKey' | 'runtimeBySessionKey' | 'sending'
  >;
}): boolean {
  const { resolvedSessionKey, runId, state } = input;
  const sessionKey = resolvedSessionKey ?? state.currentSessionKey;
  const completionRunId = eventString(runId);
  if (completionRunId && isTerminalRun(sessionKey, completionRunId)) return false;
  const runtime = getSessionRuntimeState(state.runtimeBySessionKey, sessionKey);
  if (!runtime.sending) return false;
  if (runtime.activeRunId) return completionRunId === runtime.activeRunId;
  if (!completionRunId) return false;
  // activeRunId 尚未绑定或已清空时：仍允许在发送中 finalize，避免 agent.completed
  // 因 sendAcceptance 状态不匹配而被丢弃，导致「整理工具结果」永久卡住。
  return (
    runtime.pendingFinal
    || runtime.sendAcceptance?.status === 'pending'
    || runtime.sendAcceptance?.status === 'uncertain'
    || runtime.sendAcceptance == null
  );
}

function scheduleCompletedRunHistoryReload(runId: unknown, sessionKey: unknown): void {
  const completionRunId = eventString(runId);
  const completionSessionKey = eventString(sessionKey);

  for (const [index, delayMs] of COMPLETION_HISTORY_RELOAD_DELAYS_MS.entries()) {
    setTimeout(() => {
      import('./store')
        .then(async ({ useChatStore }) => {
          const state = useChatStore.getState();
          const targetSessionKey = completionSessionKey ?? state.currentSessionKey;
          if (!shouldFinalizeCompletedRun({ runId: completionRunId, resolvedSessionKey: targetSessionKey, state })) return;
          const matchesCurrentSession = targetSessionKey === state.currentSessionKey;
          const matchesActiveRun = completionRunId != null && state.activeRunId != null && completionRunId === state.activeRunId;

          if (matchesCurrentSession || matchesActiveRun) {
            await state.loadHistory(true, true, targetSessionKey);
          }

          if (index !== COMPLETION_HISTORY_RELOAD_DELAYS_MS.length - 1) return;

          const latest = useChatStore.getState();
          if (!shouldFinalizeCompletedRun({
            runId: completionRunId,
            resolvedSessionKey: targetSessionKey,
            state: latest,
          })) return;
          const stillMatchesCurrentSession = completionSessionKey == null || completionSessionKey === latest.currentSessionKey;
          const stillMatchesActiveRun = completionRunId != null && latest.activeRunId != null && completionRunId === latest.activeRunId;
          if (stillMatchesCurrentSession || stillMatchesActiveRun) {
            if (!latest.sending) return;
            if (latest.streamingMessage || latest.streamingText) return;

            useChatStore.setState((prev) => applyRuntimePatch(
              prev,
              targetSessionKey,
              buildTerminalRuntimePatch(null),
            ));
            return;
          }

          const sessionRuntime = latest.runtimeBySessionKey[targetSessionKey];
          if (!sessionRuntime?.sending) return;
          if (sessionRuntime.streamingMessage || sessionRuntime.streamingText) return;

          useChatStore.setState((prev) => applyRuntimePatch(prev, targetSessionKey, buildTerminalRuntimePatch(null)));
          markSessionUnreadAfterSuccessfulRun(targetSessionKey, latest.currentSessionKey, {
            runId: completionRunId,
          });
        })
        .catch(() => {});
    }, delayMs);
  }
}

async function completeRunAfterAgentCompleted(
  runId: unknown,
  sessionKey: string | null,
): Promise<void> {
  const completionRunId = eventString(runId);
  const { useChatStore, finalizeOpenClawRunAfterAgentCompleted } = await import('./store');
  const before = useChatStore.getState();
  const targetSessionKey = sessionKey ?? before.currentSessionKey;
  if (!shouldFinalizeCompletedRun({ runId: completionRunId, resolvedSessionKey: targetSessionKey, state: before })) return;
  const matchesCurrentSession = targetSessionKey === before.currentSessionKey;
  const matchesActiveRun = completionRunId != null && before.activeRunId != null && completionRunId === before.activeRunId;

  if (matchesCurrentSession || matchesActiveRun) {
    await before.loadHistory(true, true, targetSessionKey);
  }

  const after = useChatStore.getState();
  if (!shouldFinalizeCompletedRun({ runId: completionRunId, resolvedSessionKey: targetSessionKey, state: after })) return;

  finalizeOpenClawRunAfterAgentCompleted(targetSessionKey, completionRunId);
}

export function handleStartedEngineEvent(
  engineEvent: Record<string, unknown>,
  shouldProcessGatewayEvent: (event: Record<string, unknown>) => boolean,
): void {
  const runId = engineEvent.runId;
  const sessionKey = engineEvent.sessionKey;
  if (runId == null || sessionKey == null) return;

  import('./store')
    .then(({ useChatStore }) => {
      const state = useChatStore.getState();
      const resolvedSessionKey = mapEventSessionKey({
        eventSessionKey: String(sessionKey),
        currentSessionKey: state.currentSessionKey,
      }) ?? String(sessionKey);
      if (shouldRefreshSessionList({
        resolvedSessionKey,
        currentSessionKey: state.currentSessionKey,
        sessions: state.sessions,
      })) {
        maybeLoadSessions(state, true);
      }

      const startedEvent = buildChatEventFromEngineEvent({
        ...engineEvent,
        sessionKey: resolvedSessionKey,
      });
      if (startedEvent && shouldProcessGatewayEvent(startedEvent)) {
        state.handleChatEvent(startedEvent);
      }
    })
    .catch(() => {});
}

export function handleCompletedEngineEvent(engineEvent: Record<string, unknown>): void {
  const runId = engineEvent.runId;
  const sessionKey = engineEvent.sessionKey;

  import('./store')
    .then(({ useChatStore }) => {
      const state = useChatStore.getState();
      const resolvedSessionKey = mapEventSessionKey({
        eventSessionKey: eventString(sessionKey),
        currentSessionKey: state.currentSessionKey,
      });
      if (shouldRefreshSessionList({
        resolvedSessionKey,
        currentSessionKey: state.currentSessionKey,
        sessions: state.sessions,
      })) {
        maybeLoadSessions(state);
      }

      const matchesCurrentSession = resolvedSessionKey == null || resolvedSessionKey === state.currentSessionKey;
      const matchesActiveRun = runId != null && state.activeRunId != null && String(runId) === state.activeRunId;

      if (matchesCurrentSession || matchesActiveRun) {
        maybeLoadHistory(state, true, resolvedSessionKey);
      }
      if (shouldFinalizeCompletedRun({ runId, resolvedSessionKey, state })) {
        void completeRunAfterAgentCompleted(runId, resolvedSessionKey).catch(() => {});
        scheduleCompletedRunHistoryReload(runId, resolvedSessionKey);
      }
    })
    .catch(() => {});
}

