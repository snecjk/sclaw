import { getLastChatEventAt } from './helpers';
import { touchLastChatEventAt } from './history-finalization';
import { setRuntimePatch } from './runtime-controller';
import type { ChatGet, ChatSet } from './store-api';

const HISTORY_POLL_SILENCE_WINDOW_MS = 2_500;
const POLL_START_DELAY_MS = 3_000;
const POLL_INTERVAL_MS = 4_000;
const SAFETY_TIMEOUT_MS = 90_000;
const STUCK_RECHECK_INTERVAL_MS = 10_000;
const STUCK_INITIAL_DELAY_MS = 30_000;

export function scheduleSendWatchdogs(input: {
  get: ChatGet;
  set: ChatSet;
  sessionKey: string;
  clearErrorRecoveryTimer: () => void;
  clearHistoryPoll: () => void;
  setHistoryPollTimer: (timer: ReturnType<typeof setTimeout> | null) => void;
}): void {
  const {
    clearErrorRecoveryTimer,
    clearHistoryPoll,
    get,
    sessionKey,
    set,
    setHistoryPollTimer,
  } = input;

  touchLastChatEventAt(set);
  clearHistoryPoll();
  clearErrorRecoveryTimer();

  const pollHistory = () => {
    const state = get();
    if (!state.sending) {
      clearHistoryPoll();
      return;
    }
    if (state.streamingMessage) {
      setHistoryPollTimer(setTimeout(pollHistory, POLL_INTERVAL_MS));
      return;
    }
    if (Date.now() - getLastChatEventAt() < HISTORY_POLL_SILENCE_WINDOW_MS) {
      setHistoryPollTimer(setTimeout(pollHistory, POLL_INTERVAL_MS));
      return;
    }
    state.loadHistory(true);
    setHistoryPollTimer(setTimeout(pollHistory, POLL_INTERVAL_MS));
  };
  setHistoryPollTimer(setTimeout(pollHistory, POLL_START_DELAY_MS));

  const checkStuck = () => {
    const state = get();
    if (!state.sending) return;
    if (state.streamingMessage || state.streamingText) return;
    if (state.pendingFinal) {
      setTimeout(checkStuck, STUCK_RECHECK_INTERVAL_MS);
      return;
    }
    if (Date.now() - getLastChatEventAt() < SAFETY_TIMEOUT_MS) {
      setTimeout(checkStuck, STUCK_RECHECK_INTERVAL_MS);
      return;
    }
    clearHistoryPoll();
    setRuntimePatch(set, sessionKey, {
      sending: false,
      activeRunId: null,
      lastUserMessageAt: null,
      optimisticUserMessage: null,
      error: 'No response received from the model. The provider may be unavailable or the API key may have insufficient quota. Please check your provider settings.',
    });
  };
  setTimeout(checkStuck, STUCK_INITIAL_DELAY_MS);
}
