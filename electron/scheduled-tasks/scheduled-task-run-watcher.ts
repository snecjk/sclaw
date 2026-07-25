/**
 * 定时任务 run 终态 watcher（抄 `channels/delivery.ts attachStreamingDelivery`
 * 骨架，去卡片推送）。补 cutover（6b37ec20）漏搬进通用 executor 的那一半：
 * adapter `sendMessage` 在 run 启动即 resolve（§0），executor 不能在 resolve 后
 * 立即置 succeeded——须靠 gateway 事件跟终态。
 *
 * 订阅 `GatewayManager`（extends EventEmitter）的 `chat:message` / `notification`，
 * 按 sessionKey 过滤，沿路累积 lastAssistantText；终态/超时回调里闭环 run 生命周期。
 *
 * 终态触发（engine-agnostic，谓词在 `engines/agent-terminal-detect.ts`；
 * 钉钉 `channels/delivery.ts` 仍用内联实现，互不 import）：
 *  - claude：`notification method=agent` 顶层 `phase=completed`（adapter result 后发）；
 *    error→chat `state=error`、abort→`state=aborted`（adapter consume loop finally）。
 *  - openclaw：`notification data.phase=end|error` 且 `stream=lifecycle`（排除 tool）；
 *    lifecycle end 后偶发 chat `state=done`。
 *  - 绝不在 `final` 片段收尾（双引擎口播 / tool 片段都带 final）。
 *
 * 双重 finalize 守卫：进程内 `finalized` flag 让 onTerminal/onTimeout 互斥；executor
 * 侧再用 `finalizeRunIfRunning`（`WHERE status='running'`）防 watcher 与 reaper 同 run
 * 双终态——后者先到者更新成功，后到者得 null 退出。
 */
import type { AgentEngineType } from '../engines/types';
import type { GatewayManager } from '../gateway/manager';
import {
  classifyAgentNotification,
  classifyChatMessage,
  engineLabel,
} from '../engines/agent-terminal-detect';
import { logger } from '../utils/logger';

export interface RunWatcherTerminalSignal {
  /**
   * 终态来源标签（notification phase 或 chat state，如 `completed`/`error`/
   * `aborted`/`done`/`end`）。**非真实 SDK stop_reason**——gateway 事件流两引擎都
   * 不带 stop_reason（claude result 只存进程内 map、不 emit；openclaw 由 gateway
   * 发 lifecycle，只读 phase）。仅用于 run 记录粗粒度归因 + 日志。
   */
  stopReason: string;
  isError: boolean;
  /** 沿路累积的 assistant 末条正文（已 trim）；日志/诊断用。 */
  lastAssistantText: string;
}

export interface RunWatcherCallbacks {
  /** agent 终态（正常完成 / error / aborted）。watcher 保证只调一次。 */
  onTerminal: (signal: RunWatcherTerminalSignal) => void;
  /** 超时（timeoutMs 到点、agent 仍未终态）。watcher 保证只调一次，与 onTerminal 互斥。 */
  onTimeout: () => void;
}

export interface AttachRunWatcherInput extends RunWatcherCallbacks {
  gatewayManager: GatewayManager;
  sessionKey: string;
  engineType?: AgentEngineType;
  /** 超时毫秒；到点未终态→onTimeout + abortRun。null/undefined 不设 in-process 超时
   *  （仅靠 scheduler reaper 兜底——但 timeoutSec 为 null 的任务 reaper 也跳过）。 */
  timeoutMs?: number | null;
  /** OpenClaw lifecycle end 后等尾部 chat 的缓冲窗（claude 传 0：final 全在 notification
   *  之前 emit，无尾丢；openclaw lifecycle end 常先于尾部 chat，需缓冲）。默认 150。 */
  finalizeDeferMs?: number;
}

/**
 * 挂 watcher。返回 detach——调用即置 finalized、清 timer、退订（executor 正常
 * 不显式 detach，靠终态/超时自闭环；进程退出残留 run 由启动期 cancelAllActiveRuns 清）。
 */
export function attachRunWatcher(input: AttachRunWatcherInput): () => void {
  const { gatewayManager, sessionKey, onTerminal, onTimeout } = input;
  const engineType = input.engineType ?? 'claude';
  const timeoutMs = input.timeoutMs ?? null;
  const finalizeDeferMs = input.finalizeDeferMs ?? 150;

  let lastAnswer = '';
  let finalized = false;
  let deferTimer: NodeJS.Timeout | null = null;
  let timeoutTimer: NodeJS.Timeout | null = null;
  const cleanup = (): void => {
    if (finalized) return; // 幂等：onTerminal / onTimeout / 显式 detach 都可能进
    finalized = true;
    if (deferTimer) {
      clearTimeout(deferTimer);
      deferTimer = null;
    }
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      timeoutTimer = null;
    }
    gatewayManager.off('chat:message', onChat);
    gatewayManager.off('notification', onNotification);
  };

  const fireTerminal = (signal: { stopReason: string; isError: boolean }): void => {
    if (finalized) return;
    cleanup();
    onTerminal({ ...signal, lastAssistantText: lastAnswer.trim() });
  };

  // 抄 delivery.ts scheduleFinalize：clear+reschedule，等尾部 chat / 同 tick 紧随事件。
  // finalizeDeferMs=0（claude）时立即 fire（setTimeout 仍走 macrotask，给同 tick emit 留序）。
  const scheduleTerminal = (signal: { stopReason: string; isError: boolean }): void => {
    if (finalized) return;
    if (deferTimer) clearTimeout(deferTimer);
    deferTimer = setTimeout(() => {
      deferTimer = null;
      fireTerminal(signal);
    }, finalizeDeferMs);
  };

  const onChat = (data: { message?: unknown }): void => {
    if (finalized) return;
    const classified = classifyChatMessage(data?.message, sessionKey);
    if (!classified) return;
    if (classified.kind === 'fragment') {
      // 沿路累积末条 assistant 正文（delta 增量 + final 整条覆盖）。lastAnswer 取
      // 最新非空——final 整条覆盖、delta 也是「至今累积文本」由 renderer 端拼好。
      if (classified.answer) lastAnswer = classified.answer;
      return;
    }
    if (classified.kind === 'terminal') {
      logger.info('[run-watcher] chat terminal', {
        sessionKey,
        engine: engineLabel(engineType),
        state: classified.state,
      });
      scheduleTerminal({ stopReason: classified.state, isError: classified.isError });
    }
    // 'started'：仅占位，忽略
  };

  const onNotification = (notification: unknown): void => {
    if (finalized) return;
    const classified = classifyAgentNotification(notification, sessionKey);
    if (!classified) return;
    if (classified.kind === 'tool') return; // watcher 不推过程态，只跟终态
    logger.info('[run-watcher] agent terminal', {
      sessionKey,
      engine: engineLabel(engineType),
      phase: classified.phase,
    });
    scheduleTerminal({ stopReason: classified.phase, isError: classified.isError });
  };

  if (timeoutMs != null && timeoutMs > 0) {
    timeoutTimer = setTimeout(() => {
      if (finalized) return;
      logger.warn('[run-watcher] timeout, force finalize', {
        sessionKey,
        engine: engineLabel(engineType),
        timeoutMs,
      });
      cleanup();
      onTimeout();
    }, timeoutMs);
  }

  gatewayManager.on('chat:message', onChat);
  gatewayManager.on('notification', onNotification);
  logger.info('[run-watcher] attached', {
    sessionKey,
    engine: engineLabel(engineType),
    timeoutMs,
    finalizeDeferMs,
  });

  return cleanup;
}
