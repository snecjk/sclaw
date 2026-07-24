import { touchLastChatEventAt } from './history-finalization';
import { setRuntimePatch } from './runtime-controller';
import { buildTerminalRuntimePatch } from './turn-state-machine';
import type { ChatGet, ChatSet } from './store-api';
import { getSessionRuntimeState } from './session-runtime';
import { logChatFlow } from './chat-flow-log';

const HISTORY_POLL_SILENCE_WINDOW_MS = 2_500;
const POLL_START_DELAY_MS = 3_000;
const POLL_INTERVAL_MS = 4_000;
const SAFETY_TIMEOUT_MS = 5 * 60_000;
const STUCK_RECHECK_INTERVAL_MS = 3_000;
const STUCK_INITIAL_DELAY_MS = 5_000;
const ACCEPTANCE_RECONCILE_TIMEOUT_MS = 135_000;
/** OpenClaw 等不到 agent.completed 时，pendingFinal 持续多久后强制收尾 */
const PENDING_FINAL_STUCK_HOLD_MS = 2_000;

/** sessionKey → first time we observed pendingFinal with no running tools */
const pendingFinalStuckSinceBySession = new Map<string, number>();

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
  pendingFinalStuckSinceBySession.delete(sessionKey);

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
      pendingFinalStuckSinceBySession.delete(sessionKey);
      clearStuckCheckTimer(sessionKey);
      return;
    }
    if (runtime.aborting) {
      setStuckCheckTimer(sessionKey, setTimeout(checkStuck, STUCK_RECHECK_INTERVAL_MS));
      return;
    }
    if (runtime.streamingMessage || runtime.streamingText) {
      setStuckCheckTimer(sessionKey, setTimeout(checkStuck, STUCK_RECHECK_INTERVAL_MS));
      return;
    }

    const hasRunningTool = runtime.streamingTools.some((tool) => tool.status === 'running');

    // pendingFinal：正文/工具轮已落定，但 agent.completed 未到。
    // 不依赖 currentSession.messages（切会话后 messages 不是本 session），直接强制收尾。
    if (runtime.pendingFinal && !hasRunningTool) {
      const firstSeen = pendingFinalStuckSinceBySession.get(sessionKey) ?? Date.now();
      pendingFinalStuckSinceBySession.set(sessionKey, firstSeen);
      if (Date.now() - firstSeen >= PENDING_FINAL_STUCK_HOLD_MS) {
        logChatFlow('watchdog.pending-final.force-complete', {
          sessionKey,
          heldFor: Date.now() - firstSeen,
          activeRunId: runtime.activeRunId,
        });
        pendingFinalStuckSinceBySession.delete(sessionKey);
        clearHistoryPoll(sessionKey);
        clearStuckCheckTimer(sessionKey);
        setRuntimePatch(set, sessionKey, buildTerminalRuntimePatch(null));
        return;
      }
      setStuckCheckTimer(sessionKey, setTimeout(checkStuck, STUCK_RECHECK_INTERVAL_MS));
      return;
    }
    pendingFinalStuckSinceBySession.delete(sessionKey);

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
