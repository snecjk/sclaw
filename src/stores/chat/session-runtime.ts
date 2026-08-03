import type { ChatSession, ChatState, SessionRuntimeState } from './types';
import {
  clearSessionEntryFromMap,
  getAgentIdFromSessionKey,
  isTemporaryAgentSessionKey,
} from './session-identity';

type RuntimeFields = Pick<
  ChatState,
  | 'sending'
  | 'activeRunId'
  | 'sendAcceptance'
  | 'streamingText'
  | 'streamingMessage'
  | 'streamingMessages'
  | 'streamingToolResults'
  | 'streamingTools'
  | 'pendingFinal'
  | 'lastUserMessageAt'
  | 'optimisticUserMessage'
  | 'pendingToolImages'
  | 'error'
>;

export function createIdleSessionRuntimeState(): SessionRuntimeState {
  return {
    sending: false,
    aborting: false,
    activeRunId: null,
    sendAcceptance: null,
    streamingText: '',
    streamingMessage: null,
    streamingMessages: [],
    streamingToolResults: [],
    streamingTools: [],
    pendingFinal: false,
    lastUserMessageAt: null,
    optimisticUserMessage: null,
    pendingToolImages: [],
    error: null,
    updatedAt: 0,
  };
}

export function runtimePatchFromSessionRuntime(runtime: SessionRuntimeState): RuntimeFields {
  return {
    sending: runtime.sending,
    activeRunId: runtime.activeRunId,
    sendAcceptance: runtime.sendAcceptance,
    streamingText: runtime.streamingText,
    streamingMessage: runtime.streamingMessage,
    streamingMessages: runtime.streamingMessages,
    streamingToolResults: runtime.streamingToolResults,
    streamingTools: runtime.streamingTools,
    pendingFinal: runtime.pendingFinal,
    lastUserMessageAt: runtime.lastUserMessageAt,
    optimisticUserMessage: runtime.optimisticUserMessage,
    pendingToolImages: runtime.pendingToolImages,
    error: runtime.error,
  };
}

export function captureTopLevelRuntime(state: RuntimeFields, aborting = false): SessionRuntimeState {
  return {
    sending: state.sending,
    aborting,
    activeRunId: state.activeRunId,
    sendAcceptance: state.sendAcceptance,
    streamingText: state.streamingText,
    streamingMessage: state.streamingMessage,
    streamingMessages: state.streamingMessages,
    streamingToolResults: state.streamingToolResults,
    streamingTools: state.streamingTools,
    pendingFinal: state.pendingFinal,
    lastUserMessageAt: state.lastUserMessageAt,
    optimisticUserMessage: state.optimisticUserMessage,
    pendingToolImages: state.pendingToolImages,
    error: state.error,
    updatedAt: Date.now(),
  };
}

export function getSessionRuntimeState(
  runtimeBySessionKey: Record<string, SessionRuntimeState>,
  sessionKey: string,
): SessionRuntimeState {
  return runtimeBySessionKey[sessionKey] ?? createIdleSessionRuntimeState();
}

export function clearActivatingSessionIfHandedOff(
  activatingScheduledSessionAt: Record<string, number>,
  sessionKey: string,
  runtimeBySessionKey: Record<string, SessionRuntimeState>,
  sessionLastActivity: Record<string, number>,
  sessions: ChatSession[],
): Record<string, number> {
  if (!activatingScheduledSessionAt[sessionKey]) return activatingScheduledSessionAt;
  const runtime = runtimeBySessionKey[sessionKey];
  const session = sessions.find((item) => item.key === sessionKey);
  const hasActivity = (sessionLastActivity[sessionKey] ?? 0) > 0
    || (typeof session?.updatedAt === 'number' && Number.isFinite(session.updatedAt) && session.updatedAt > 0);
  if (!runtime?.sending && !runtime?.activeRunId && !hasActivity) return activatingScheduledSessionAt;
  const next = { ...activatingScheduledSessionAt };
  delete next[sessionKey];
  return next;
}

export function patchSessionRuntimeState(
  state: ChatState,
  sessionKey: string,
  patch: Partial<SessionRuntimeState> | ((runtime: SessionRuntimeState) => Partial<SessionRuntimeState>),
): Partial<ChatState> {
  const currentRuntime = getSessionRuntimeState(state.runtimeBySessionKey, sessionKey);
  const partial = typeof patch === 'function' ? patch(currentRuntime) : patch;
  const nextRuntime: SessionRuntimeState = {
    ...currentRuntime,
    ...partial,
    updatedAt: partial.updatedAt ?? Date.now(),
  };
  const nextPatch: Partial<ChatState> = {
    runtimeBySessionKey: { ...state.runtimeBySessionKey, [sessionKey]: nextRuntime },
  };
  if (nextRuntime.sending || nextRuntime.activeRunId) {
    const nextActivating = clearActivatingSessionIfHandedOff(
      state.activatingScheduledSessionAt,
      sessionKey,
      nextPatch.runtimeBySessionKey as Record<string, SessionRuntimeState>,
      state.sessionLastActivity,
      state.sessions,
    );
    if (nextActivating !== state.activatingScheduledSessionAt) {
      nextPatch.activatingScheduledSessionAt = nextActivating;
    }
  }
  if (sessionKey === state.currentSessionKey) {
    Object.assign(nextPatch, runtimePatchFromSessionRuntime(nextRuntime));
  }
  return nextPatch;
}

type SessionSwitchState = Pick<
  ChatState,
  | 'currentSessionKey'
  | 'messages'
  | 'sessions'
  | 'sessionLabels'
  | 'sessionLastActivity'
  | 'runtimeBySessionKey'
  | 'sending'
  | 'activeRunId'
  | 'sendAcceptance'
  | 'streamingText'
  | 'streamingMessage'
  | 'streamingMessages'
  | 'streamingToolResults'
  | 'streamingTools'
  | 'pendingFinal'
  | 'lastUserMessageAt'
  | 'optimisticUserMessage'
  | 'pendingToolImages'
  | 'error'
>;

export function ensureSessionEntry(
  sessions: ChatSession[],
  sessionKey: string,
  resolveEngineType: (sessionKey: string) => ChatSession['engineType'],
): ChatSession[] {
  return sessions.some((session) => session.key === sessionKey)
    ? sessions
    : [...sessions, { key: sessionKey, engineType: resolveEngineType(sessionKey) }];
}

/**
 * Captures the leaving session before clearing top-level fields, then restores
 * the destination session's cached runtime. The dependency is injected so the
 * state transition remains independent of the agents store.
 */
export function buildSessionSwitchPatch(
  state: SessionSwitchState,
  nextSessionKey: string,
  resolveEngineType: (sessionKey: string) => ChatSession['engineType'],
): Partial<ChatState> {
  const leavingEmpty = isTemporaryAgentSessionKey(state.currentSessionKey)
    && state.messages.length === 0
    && !state.sessionLastActivity[state.currentSessionKey]
    && !state.sessionLabels[state.currentSessionKey];
  const nextSessions = leavingEmpty
    ? state.sessions.filter((session) => session.key !== state.currentSessionKey)
    : state.sessions;
  const nextRuntimeBySessionKey = {
    ...state.runtimeBySessionKey,
    [state.currentSessionKey]: captureTopLevelRuntime(
      state,
      state.runtimeBySessionKey[state.currentSessionKey]?.aborting ?? false,
    ),
  };
  if (leavingEmpty) delete nextRuntimeBySessionKey[state.currentSessionKey];

  const nextRuntime = getSessionRuntimeState(nextRuntimeBySessionKey, nextSessionKey);
  return {
    currentSessionKey: nextSessionKey,
    currentAgentId: getAgentIdFromSessionKey(nextSessionKey),
    pendingProjectId: null,
    sessions: ensureSessionEntry(nextSessions, nextSessionKey, resolveEngineType),
    runtimeBySessionKey: nextRuntimeBySessionKey,
    sessionLabels: leavingEmpty
      ? clearSessionEntryFromMap(state.sessionLabels, state.currentSessionKey)
      : state.sessionLabels,
    sessionLastActivity: leavingEmpty
      ? clearSessionEntryFromMap(state.sessionLastActivity, state.currentSessionKey)
      : state.sessionLastActivity,
    messages: [],
    ...runtimePatchFromSessionRuntime(nextRuntime),
    pendingWorkflow: null,
  };
}
