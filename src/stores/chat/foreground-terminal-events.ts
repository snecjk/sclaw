import { setRuntimePatch } from './runtime-controller';
import { executeTurnEffects } from './turn-effects';
import type { ChatGet, ChatSet } from './store-api';
import type { ChatSession, RawMessage } from './types';
import { getSessionRuntimeState } from './session-runtime';
import { recordTerminalRun } from './run-lifecycle';

export function handleForegroundFinalWithoutMessage(input: {
  get: ChatGet;
  set: ChatSet;
  runId: string;
  resolveEngineTypeForSession: (
    sessions: ChatSession[],
    sessionKey: string,
    currentAgentId?: string | null,
  ) => ChatSession['engineType'] | undefined;
  dispatchAgentMemoryCapture: (input: {
    agentId?: string | null;
    runId?: string | null;
    sessionKey?: string | null;
    engineType?: ChatSession['engineType'];
  }) => void;
}): void {
  const {
    dispatchAgentMemoryCapture,
    get,
    resolveEngineTypeForSession,
    runId,
    set,
  } = input;
  const sessionKey = get().currentSessionKey;

  setRuntimePatch(set, sessionKey, {
    streamingText: '',
    streamingMessage: null,
    pendingFinal: true,
  });
  executeTurnEffects([{
    type: 'captureMemory',
    agentId: get().currentAgentId,
    runId: runId || undefined,
    sessionKey,
    engineType: resolveEngineTypeForSession(
      get().sessions,
      sessionKey,
      get().currentAgentId,
    ),
  }], { get, set, dispatchMemoryCapture: dispatchAgentMemoryCapture });
  get().loadHistory();
}

export function handleForegroundErrorEvent(input: {
  get: ChatGet;
  set: ChatSet;
  sessionKey: string;
  runId: string;
  errorMessage: string;
  clearHistoryPoll: () => void;
  clearErrorRecoveryTimer: () => void;
  setErrorRecoveryTimer: (timer: ReturnType<typeof setTimeout> | null) => void;
}): void {
  const {
    clearErrorRecoveryTimer,
    clearHistoryPoll,
    errorMessage,
    get,
    runId,
    sessionKey,
    set,
    setErrorRecoveryTimer,
  } = input;
  const wasSending = getSessionRuntimeState(get().runtimeBySessionKey, sessionKey).sending;

  const currentStream = get().streamingMessage as RawMessage | null;
  if (currentStream && (currentStream.role === 'assistant' || currentStream.role === undefined)) {
    const snapId = currentStream.id || `error-snap-${Date.now()}`;
    const alreadyExists = get().messages.some(message => message.id === snapId);
    if (!alreadyExists) {
      set((state) => ({
        messages: [...state.messages, { ...currentStream, role: 'assistant' as const, id: snapId }],
      }));
    }
  }

  setRuntimePatch(set, sessionKey, {
    error: errorMessage,
    streamingText: '',
    streamingMessage: null,
    streamingMessages: [],
    streamingToolResults: [],
    streamingTools: [],
    pendingFinal: false,
    pendingToolImages: [],
  });

  if (wasSending) {
    clearErrorRecoveryTimer();
    const ERROR_RECOVERY_GRACE_MS = 15_000;
    setErrorRecoveryTimer(setTimeout(() => {
      setErrorRecoveryTimer(null);
      const state = get();
      const runtime = getSessionRuntimeState(state.runtimeBySessionKey, sessionKey);
      if (runtime.sending && !runtime.streamingMessage && (!runId || runtime.activeRunId === runId)) {
        clearHistoryPoll();
        setRuntimePatch(set, sessionKey, {
          sending: false,
          activeRunId: null,
          sendAcceptance: null,
          lastUserMessageAt: null,
        });
        recordTerminalRun(sessionKey, runId);
        state.loadHistory(true, true, sessionKey);
      }
    }, ERROR_RECOVERY_GRACE_MS));
    return;
  }

  clearHistoryPoll();
  setRuntimePatch(set, sessionKey, {
    sending: false,
    activeRunId: null,
    sendAcceptance: null,
    lastUserMessageAt: null,
    optimisticUserMessage: null,
  });
  recordTerminalRun(sessionKey, runId);
}

export function handleForegroundAbortedEvent(input: {
  set: ChatSet;
  sessionKey: string;
  clearHistoryPoll: () => void;
  clearErrorRecoveryTimer: () => void;
}): void {
  const {
    clearErrorRecoveryTimer,
    clearHistoryPoll,
    sessionKey,
    set,
  } = input;

  clearHistoryPoll();
  clearErrorRecoveryTimer();
  setRuntimePatch(set, sessionKey, {
    sending: false,
    activeRunId: null,
    sendAcceptance: null,
    streamingText: '',
    streamingMessage: null,
    streamingMessages: [],
    streamingToolResults: [],
    streamingTools: [],
    pendingFinal: false,
    lastUserMessageAt: null,
    pendingToolImages: [],
  });
}
