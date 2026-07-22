import { isVirtualTaskSessionKey } from './cron-session-utils';
import { setRuntimePatch } from './runtime-controller';
import { recordTerminalRun } from './run-lifecycle';
import { getSessionRuntimeState } from './session-runtime';
import type { ChatGet, ChatSet } from './store-api';

type Timer = ReturnType<typeof setTimeout>;

/**
 * G3 fallback — "卡 loading" 兜底。
 *
 * 定时/后台触发的 run（虚拟任务会话）经过 `createBackgroundSessionEventHandler`
 * 落到 dated 会话，但它**不**经过 `scheduleSendWatchdogs`（那是前台用户发送路径
 * 专属）。一旦 `started` 之后 `final`/`error`/`aborted` 永不到达（网关崩溃、事件
 * 丢弃），该会话会永久停在 `sending:true`，侧栏永远转圈。
 *
 * 这里在共享的 stuck-check timer 槽（`recordTerminalRun` → `clearSessionRuntimeTimers`
 * 会自动清掉）上挂一个轻量看门狗，仅在虚拟任务会话上启用，避免与前台发送看门狗
 * 竞争普通会话。阈值只盯"无任何活动"，长任务只要还在发 delta/agent 事件就不清。
 */
const BG_STUCK_INITIAL_DELAY_MS = 90_000;
const BG_STUCK_RECHECK_INTERVAL_MS = 30_000;
const BG_STUCK_SILENCE_MS = 90_000;

/** 本次运行期间观测到的最近一次后台 run 活动（任意事件，含 agent-only）。按 sessionKey 记。 */
const lastObservedAtBySession = new Map<string, number>();

/**
 * 在后台事件处理器里每次接受事件后调用，刷新"最近活动"时间。
 * 含无 message 的 `agent` 相位事件——长任务在两段 delta 之间只发 agent 事件时，
 * 用 `runtime.updatedAt`（仅在有 message 时才 stamp）会误判卡住，故单独维护。
 * 仅对虚拟任务会话记录，避免普通会话无界增长。
 */
export function noteBackgroundRunActivity(sessionKey: string): void {
  if (!isVirtualTaskSessionKey(sessionKey)) return;
  lastObservedAtBySession.set(sessionKey, Date.now());
}

/** 终态（final/error/aborted）或会话清理时调用，释放跟踪条目。 */
export function clearBackgroundRunActivity(sessionKey: string): void {
  lastObservedAtBySession.delete(sessionKey);
}

export function scheduleBackgroundRunWatchdog(input: {
  get: ChatGet;
  set: ChatSet;
  sessionKey: string;
  runId: string;
  setStuckCheckTimer: (sessionKey: string, timer: Timer | null) => void;
  clearStuckCheckTimer: (sessionKey: string) => void;
}): void {
  const { get, set, sessionKey, runId, setStuckCheckTimer, clearStuckCheckTimer } = input;
  // 仅虚拟任务会话启用——普通会话由前台 send-watchdog 覆盖，避免共用同一 timer 槽竞争。
  if (!isVirtualTaskSessionKey(sessionKey) || !runId) return;

  const checkStuck = () => {
    const state = get();
    const runtime = getSessionRuntimeState(state.runtimeBySessionKey, sessionKey);
    // run 已正常终态（final/error/aborted 已清 sending/activeRunId）→ 停止看护。
    if (!runtime.sending || !runtime.activeRunId || runtime.activeRunId !== runId) {
      clearStuckCheckTimer(sessionKey);
      clearBackgroundRunActivity(sessionKey);
      return;
    }
    // 健康迹象：仍在流式或待 final。
    if (runtime.streamingMessage || runtime.streamingText || runtime.pendingFinal) {
      setStuckCheckTimer(sessionKey, setTimeout(checkStuck, BG_STUCK_RECHECK_INTERVAL_MS));
      return;
    }
    // 静默时长：用"最近观测活动"（agent 事件也算）而非 updatedAt，避免长任务误判。
    const lastObserved = lastObservedAtBySession.get(sessionKey) ?? runtime.updatedAt;
    const silentFor = Date.now() - lastObserved;
    if (silentFor < BG_STUCK_SILENCE_MS) {
      setStuckCheckTimer(sessionKey, setTimeout(checkStuck, BG_STUCK_RECHECK_INTERVAL_MS));
      return;
    }
    // 卡住：>90s 无任何活动且 run 从未终态。强制清 sending/activeRunId，避免永久 loading。
    clearStuckCheckTimer(sessionKey);
    clearBackgroundRunActivity(sessionKey);
    recordTerminalRun(sessionKey, runId);
    setRuntimePatch(set, sessionKey, {
      sending: false,
      aborting: false,
      activeRunId: null,
      sendAcceptance: null,
      lastUserMessageAt: null,
      optimisticUserMessage: null,
      error: '后台运行长时间未返回结果，可能已中断。请稍后重试或刷新历史记录确认。',
    });
  };

  clearStuckCheckTimer(sessionKey);
  setStuckCheckTimer(sessionKey, setTimeout(checkStuck, BG_STUCK_INITIAL_DELAY_MS));
}
