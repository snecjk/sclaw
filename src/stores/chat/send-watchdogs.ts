import { touchLastChatEventAt } from './history-finalization';
import { setRuntimePatch } from './runtime-controller';
import type { ChatGet, ChatSet } from './store-api';
import { getSessionRuntimeState } from './session-runtime';

const HISTORY_POLL_SILENCE_WINDOW_MS = 2_500;
const POLL_START_DELAY_MS = 3_000;
const POLL_INTERVAL_MS = 4_000;
const SAFETY_TIMEOUT_MS = 90_000;
const STUCK_RECHECK_INTERVAL_MS = 10_000;
const STUCK_INITIAL_DELAY_MS = 30_000;
const ACCEPTANCE_RECONCILE_TIMEOUT_MS = 135_000;

export function scheduleSendWatchdogs(input: {
  get: ChatGet;
  set: ChatSet;
  sessionKey: string;
  clearErrorRecoveryTimer: (sessionKey: string) => void;
  clearHistoryPoll: (sessionKey: string) => void;
  setHistoryPollTimer: (sessionKey: string, timer: ReturnType<typeof setTimeout> | null) => void;
  clearStuckCheckTimer: (sessionKey: string) => void;
  setStuckCheckTimer: (sessionKey: string, timer: ReturnType<typeof setTimeout> | null) => void;
}): void {
  const {
    clearErrorRecoveryTimer,
    clearHistoryPoll,
    clearStuckCheckTimer,
    get,
    sessionKey,
    set,
    setHistoryPollTimer,
    setStuckCheckTimer,
  } = input;

  touchLastChatEventAt(set);
  clearHistoryPoll(sessionKey);
  clearErrorRecoveryTimer(sessionKey);
  clearStuckCheckTimer(sessionKey);

  const pollHistory = () => {
    const state = get();
    const runtime = getSessionRuntimeState(state.runtimeBySessionKey, sessionKey);
    if (!runtime.sending) {
      clearHistoryPoll(sessionKey);
      return;
    }
    if (runtime.streamingMessage) {
      setHistoryPollTimer(sessionKey, setTimeout(pollHistory, POLL_INTERVAL_MS));
      return;
    }
    if (Date.now() - runtime.updatedAt < HISTORY_POLL_SILENCE_WINDOW_MS) {
      setHistoryPollTimer(sessionKey, setTimeout(pollHistory, POLL_INTERVAL_MS));
      return;
    }
    void state.loadHistory(true, false, sessionKey);
    setHistoryPollTimer(sessionKey, setTimeout(pollHistory, POLL_INTERVAL_MS));
  };
  setHistoryPollTimer(sessionKey, setTimeout(pollHistory, POLL_START_DELAY_MS));

  const checkStuck = () => {
    const state = get();
    const runtime = getSessionRuntimeState(state.runtimeBySessionKey, sessionKey);
    if (!runtime.sending) {
      clearStuckCheckTimer(sessionKey);
      return;
    }
    if (runtime.streamingMessage || runtime.streamingText) {
      setStuckCheckTimer(sessionKey, setTimeout(checkStuck, STUCK_RECHECK_INTERVAL_MS));
      return;
    }
    if (runtime.pendingFinal) {
      setStuckCheckTimer(sessionKey, setTimeout(checkStuck, STUCK_RECHECK_INTERVAL_MS));
      return;
    }
    const acceptanceAge = runtime.sendAcceptance
      ? Date.now() - runtime.sendAcceptance.startedAt
      : 0;
    const timeoutMs = runtime.sendAcceptance?.status === 'uncertain'
      ? ACCEPTANCE_RECONCILE_TIMEOUT_MS
      : SAFETY_TIMEOUT_MS;
    if (acceptanceAge < timeoutMs && Date.now() - runtime.updatedAt < timeoutMs) {
      setStuckCheckTimer(sessionKey, setTimeout(checkStuck, STUCK_RECHECK_INTERVAL_MS));
      return;
    }
    clearHistoryPoll(sessionKey);
    clearStuckCheckTimer(sessionKey);
    setRuntimePatch(set, sessionKey, {
      sending: false,
      activeRunId: null,
      sendAcceptance: null,
      lastUserMessageAt: null,
      optimisticUserMessage: null,
      error: runtime.sendAcceptance?.status === 'uncertain'
        ? '无法确认消息是否已发送，请刷新历史记录确认后再重试。'
        : 'No response received from the model. The provider may be unavailable or the API key may have insufficient quota. Please check your provider settings.',
    });
  };
  setStuckCheckTimer(sessionKey, setTimeout(checkStuck, STUCK_INITIAL_DELAY_MS));
}
