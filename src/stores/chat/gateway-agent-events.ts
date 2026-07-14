import { markSessionUnreadAfterSuccessfulRun } from '@/lib/session-unread-notify';
import { buildChatEventFromEngineEvent } from './gateway-event-normalization';
import { applyRuntimePatch } from './runtime-controller';
import { mapEventSessionKey } from './session-event-routing';
import { buildTerminalRuntimePatch } from './turn-state-machine';
import type { ChatState } from './types';

const LOAD_SESSIONS_MIN_INTERVAL_MS = 1_200;
const LOAD_HISTORY_MIN_INTERVAL_MS = 800;
const COMPLETION_HISTORY_RELOAD_DELAYS_MS = [1_000, 3_000, 7_000];

let lastLoadSessionsAt = 0;
let lastLoadHistoryAt = 0;

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
  state: { loadHistory: (quiet?: boolean, force?: boolean) => Promise<void> },
  force = false,
): void {
  const now = Date.now();
  if (!force && now - lastLoadHistoryAt < LOAD_HISTORY_MIN_INTERVAL_MS) return;
  lastLoadHistoryAt = now;
  void state.loadHistory(true, force);
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

function shouldFinalizeCompletedRun(input: {
  runId: unknown;
  resolvedSessionKey: string | null;
  state: Pick<ChatState, 'activeRunId' | 'currentSessionKey' | 'runtimeBySessionKey' | 'sending'>;
}): boolean {
  const { resolvedSessionKey, runId, state } = input;
  const matchesCurrentSession = resolvedSessionKey == null || resolvedSessionKey === state.currentSessionKey;
  const matchesActiveRun = runId != null && state.activeRunId != null && String(runId) === state.activeRunId;
  const backgroundRuntime = resolvedSessionKey ? state.runtimeBySessionKey[resolvedSessionKey] : null;
  const hasBackgroundActiveRuntime = Boolean(backgroundRuntime?.sending);

  return ((matchesCurrentSession || matchesActiveRun) && state.sending)
    || Boolean(resolvedSessionKey && hasBackgroundActiveRuntime);
}

function scheduleCompletedRunHistoryReload(runId: unknown, sessionKey: unknown): void {
  const completionRunId = eventString(runId);
  const completionSessionKey = eventString(sessionKey);

  for (const [index, delayMs] of COMPLETION_HISTORY_RELOAD_DELAYS_MS.entries()) {
    setTimeout(() => {
      import('./store')
        .then(async ({ useChatStore }) => {
          const state = useChatStore.getState();
          const matchesCurrentSession = completionSessionKey == null || completionSessionKey === state.currentSessionKey;
          const matchesActiveRun = completionRunId != null && state.activeRunId != null && completionRunId === state.activeRunId;
          const backgroundRuntime = completionSessionKey ? state.runtimeBySessionKey[completionSessionKey] : null;
          const hasBackgroundActiveRuntime = Boolean(backgroundRuntime?.sending);
          if (!matchesCurrentSession && !matchesActiveRun && !hasBackgroundActiveRuntime) return;

          if (matchesCurrentSession || matchesActiveRun) {
            await state.loadHistory(true, true);
          }

          if (index !== COMPLETION_HISTORY_RELOAD_DELAYS_MS.length - 1) return;

          const latest = useChatStore.getState();
          const stillMatchesCurrentSession = completionSessionKey == null || completionSessionKey === latest.currentSessionKey;
          const stillMatchesActiveRun = completionRunId != null && latest.activeRunId != null && completionRunId === latest.activeRunId;
          if (stillMatchesCurrentSession || stillMatchesActiveRun) {
            if (!latest.sending) return;
            if (latest.streamingMessage || latest.streamingText) return;

            useChatStore.setState((prev) => applyRuntimePatch(
              prev,
              completionSessionKey ?? latest.currentSessionKey,
              buildTerminalRuntimePatch(null),
            ));
            return;
          }

          if (!completionSessionKey) return;
          const sessionRuntime = latest.runtimeBySessionKey[completionSessionKey];
          if (!sessionRuntime?.sending) return;
          if (sessionRuntime.streamingMessage || sessionRuntime.streamingText) return;

          useChatStore.setState((prev) => applyRuntimePatch(prev, completionSessionKey, buildTerminalRuntimePatch(null)));
          markSessionUnreadAfterSuccessfulRun(completionSessionKey, latest.currentSessionKey, {
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
  const matchesCurrentSession = sessionKey == null || sessionKey === before.currentSessionKey;
  const matchesActiveRun = completionRunId != null
    && before.activeRunId != null
    && completionRunId === before.activeRunId;

  if (matchesCurrentSession || matchesActiveRun) {
    await before.loadHistory(true, true);
  }

  const after = useChatStore.getState();
  if (completionRunId != null && after.activeRunId != null && completionRunId !== after.activeRunId) {
    return;
  }

  finalizeOpenClawRunAfterAgentCompleted(sessionKey, completionRunId);
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
        maybeLoadHistory(state, true);
      }
      if (shouldFinalizeCompletedRun({ runId, resolvedSessionKey, state })) {
        void completeRunAfterAgentCompleted(runId, resolvedSessionKey).catch(() => {});
        scheduleCompletedRunHistoryReload(runId, resolvedSessionKey);
      }
    })
    .catch(() => {});
}

