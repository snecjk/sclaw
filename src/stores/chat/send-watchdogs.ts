import { touchLastChatEventAt } from './history-finalization';
import { setRuntimePatch } from './runtime-controller';
import type { ChatGet, ChatSet } from './store-api';
import { getSessionRuntimeState } from './session-runtime';
import { logChatFlow } from './chat-flow-log';

const HISTORY_POLL_SILENCE_WINDOW_MS = 5_000;
const POLL_START_DELAY_MS = 3_000;
const POLL_INTERVAL_MS = 4_000;
const SAFETY_TIMEOUT_MS = 5 * 60_000;
const STUCK_RECHECK_INTERVAL_MS = 3_000;
const STUCK_INITIAL_DELAY_MS = 5_000;
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
    if (Date.now() - runtime.updatedAt < HISTORY_POLL_SILENCE_WINDOW_MS) {
      setHistoryPollTimer(sessionKey, setTimeout(pollHistory, POLL_INTERVAL_MS));
      return;
    }
    void state.loadHistory(true, true, sessionKey);
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
    if (runtime.aborting) {
      setStuckCheckTimer(sessionKey, setTimeout(checkStuck, STUCK_RECHECK_INTERVAL_MS));
      return;
    }
    const hasRunningTool = runtime.streamingTools.some((tool) => tool.status === 'running');

    // pendingFinal 不是整轮 completed。先用权威 history 校准；只有 history
    // 确认已有 assistant 正文后，history-runtime-completion 才会结束运行态。
    if (runtime.pendingFinal && !hasRunningTool) {
      logChatFlow('watchdog.pending-final.reconcile-history', {
        sessionKey,
        activeRunId: runtime.activeRunId,
      });
      void state.loadHistory(true, true, sessionKey);
    }

    // 用 sendAcceptance.startedAt，避免 history poll 刷新 updatedAt 导致永不超时
    const acceptanceAge = runtime.sendAcceptance
      ? Date.now() - runtime.sendAcceptance.startedAt
      : Date.now() - (runtime.updatedAt || Date.now());
    const timeoutMs = runtime.sendAcceptance?.status === 'uncertain'
      ? ACCEPTANCE_RECONCILE_TIMEOUT_MS
      : SAFETY_TIMEOUT_MS;
    if (acceptanceAge < timeoutMs) {
      setStuckCheckTimer(sessionKey, setTimeout(checkStuck, STUCK_RECHECK_INTERVAL_MS));
      return;
    }
    clearHistoryPoll(sessionKey);
    clearStuckCheckTimer(sessionKey);
    setRuntimePatch(set, sessionKey, {
      sending: false,
      aborting: false,
      activeRunId: null,
      sendAcceptance: null,
      lastUserMessageAt: null,
      optimisticUserMessage: null,
      pendingFinal: false,
      error: runtime.sendAcceptance?.status === 'uncertain'
        ? '无法确认消息是否已发送，请刷新历史记录确认后再重试。'
        : '等待响应时间较长，界面已停止等待。任务可能仍在后台执行，请稍后刷新对话查看结果；如仍无结果，请重试。',
    });
  };
  setStuckCheckTimer(sessionKey, setTimeout(checkStuck, STUCK_INITIAL_DELAY_MS));
}
