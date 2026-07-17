import { setRuntimePatch } from './runtime-controller';
import type { ChatGet, ChatSet } from './store-api';
import type { RawMessage } from './types';
import { getSessionRuntimeState } from './session-runtime';
import { recordTerminalRun } from './run-lifecycle';
import { discardAgentMemoriesForAbnormalTurn } from '@/lib/agent-execution-memory';

export function handleForegroundFinalWithoutMessage(input: {
  get: ChatGet;
  set: ChatSet;
}): void {
  const {
    get,
    set,
  } = input;
  const sessionKey = get().currentSessionKey;

  setRuntimePatch(set, sessionKey, {
    streamingText: '',
    streamingMessage: null,
    pendingFinal: true,
  });
  // A message-less final is only a transport fragment, not proof that the
  // run completed normally. Memory capture waits for agent.completed or a
  // successful history reconciliation.
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
        discardAgentMemoriesForAbnormalTurn({
          sessionKey,
          runId: runId || runtime.activeRunId,
          reason: 'failed',
        });
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
  discardAgentMemoriesForAbnormalTurn({
    sessionKey,
    runId,
    reason: 'failed',
  });
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
  runId?: string | null;
  clearHistoryPoll: () => void;
  clearErrorRecoveryTimer: () => void;
}): void {
  const {
    clearErrorRecoveryTimer,
    clearHistoryPoll,
    runId,
    sessionKey,
    set,
  } = input;

  clearHistoryPoll();
  clearErrorRecoveryTimer();
  discardAgentMemoriesForAbnormalTurn({
    sessionKey,
    runId,
    reason: 'aborted',
  });
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
