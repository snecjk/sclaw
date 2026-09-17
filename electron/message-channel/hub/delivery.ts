import type { GatewayManager } from '../../gateway/manager';
import type { NormalizedEngineEvent } from '../../gateway/normalized-engine-event';
import {
  STATUS_MAX_CHARS,
  classifyAgentNotification,
  classifyChatMessage,
  isSameSessionKey,
} from '../../engines/agent-terminal-detect';
import { logger } from '../../utils/logger';
import { hubReplyStream } from './hub-api';
import { getSclawHubClient } from './hub-client';
import {
  resolveStreamContentKind,
  type StreamContentKind,
} from '../common/stream-content-kind';

const MIN_PUSH_INTERVAL_MS = 450;
/** lifecycle end → 尾部 chat 的缓冲窗 */
const FINALIZE_DEFER_MS = 150;

function pushReply(
  chatUid: string,
  content: string,
  finalize: boolean,
  sessionKey: string | undefined,
  contentKind: StreamContentKind,
): void {
  const client = getSclawHubClient();
  const ok = client.sendDelta(chatUid, content, finalize, { sessionKey, contentKind });
  if (ok) {
    logger.info('[SclawDelivery] ws reply', {
      chatUid,
      finalize,
      contentKind,
      contentLen: content.length,
      sessionKey: sessionKey ?? null,
    });
    if (finalize) {
      void hubReplyStream({ chatUid, content, finalize: true, contentKind }).catch((error) => {
        logger.warn('[SclawDelivery] HTTP finalize backup failed', error);
      });
    }
    return;
  }
  logger.warn('[SclawDelivery] ws not connected, HTTP reply', { chatUid, finalize, contentKind });
  void hubReplyStream({ chatUid, content, finalize, contentKind }).catch((error) => {
    logger.warn('[SclawDelivery] HTTP reply fallback failed', error);
  });
}

export type StreamingDeliveryHandle = {
  /** 强制卸监听（不额外 flush）；已 finalize 时为 no-op。 */
  detach: () => void;
  /** finalize / timeout / detach 后 resolve，供 ingress 串行等到本轮结束。 */
  finished: Promise<void>;
};

type ChatMessageListenerArg = {
  message?: {
    sessionKey?: string;
    state?: string;
    errorMessage?: string;
    message?: unknown;
  };
  engineEvent?: NormalizedEngineEvent;
};

/**
 * 全程只更新钉钉/Mobile 卡片 content：
 * - 过程中：尚无正文时用思考/工具状态占位，卡片在动
 * - 结束后：只推完整回答，覆盖过程文案
 *
 * 终态语义（与微信 bridge-outbound / agent-terminal-detect 对齐）：
 * 1) chat.state=final 一律当片段：工具前口播 / tool_use / 真答案都可能带 final；
 *    绝不能在此 finalize（否则截口播，或空 final →「无回复内容」）。
 * 2) 真正收尾：
 *    - Pi：engineEvent turn.completed，或 legacy state=completed
 *    - Claude：顶层 phase=completed（adapter 在 result 后发出）
 *    - OpenClaw：data.phase=end|error（stream=lifecycle）；工具事件也有 data.phase，
 *      但 stream=tool，必须先过滤，不能把 tool end 当成整轮结束。
 * 3) 部分引擎会先广播 lifecycle end、再 emit 尾部 chat；终态后短暂延期再 finalize，
 *    避免听筒已卸、丢最后一段正文。
 */
export function attachStreamingDelivery(input: {
  gatewayManager: GatewayManager;
  sessionKey: string;
  chatUid: string;
  engineType?: 'claude' | 'pi';
  timeoutMs?: number;
}): StreamingDeliveryHandle {
  const { gatewayManager, sessionKey, chatUid } = input;
  const engineType: 'claude' | 'pi' = input.engineType === 'claude' ? 'claude' : 'pi';
  const timeoutMs = input.timeoutMs ?? 10 * 60 * 1000;
  let lastAnswer = '';
  let lastStatus = '正在分析你的问题...';
  let lastSent = '';
  let lastSentKind: StreamContentKind | null = null;
  let lastPushAt = 0;
  let cleaned = false;
  let pendingTimer: NodeJS.Timeout | null = null;
  let finalizeTimer: NodeJS.Timeout | null = null;

  let resolveFinished: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });

  const visibleContent = (finalize: boolean): string => {
    if (finalize) {
      return lastAnswer.trim() || '（无回复内容）';
    }
    // 有正文就推正文；否则推过程占位（覆盖，不追加）
    return (lastAnswer.trim() || lastStatus.trim() || '正在分析你的问题...').slice(0, STATUS_MAX_CHARS);
  };

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(timer);
    if (pendingTimer) clearTimeout(pendingTimer);
    if (finalizeTimer) clearTimeout(finalizeTimer);
    gatewayManager.off('chat:message', onChat);
    gatewayManager.off('notification', onNotification);
    resolveFinished();
  };

  const flush = (finalize: boolean) => {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    const content = visibleContent(finalize);
    const contentKind = resolveStreamContentKind({
      finalize,
      answer: lastAnswer,
    });
    // 同文案但 kind 变化（如占位→正文）仍需再推，避免 App 分不出语义
    if (!finalize && content === lastSent && contentKind === lastSentKind) return;
    lastSent = content;
    lastSentKind = contentKind;
    lastPushAt = Date.now();
    pushReply(chatUid, content, finalize, sessionKey, contentKind);
  };

  const schedulePush = () => {
    const elapsed = Date.now() - lastPushAt;
    if (elapsed >= MIN_PUSH_INTERVAL_MS) {
      flush(false);
      return;
    }
    if (pendingTimer) return;
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      flush(false);
    }, MIN_PUSH_INTERVAL_MS - elapsed);
  };

  const finalize = (answer?: string) => {
    if (cleaned) return;
    if (typeof answer === 'string' && answer.trim()) {
      lastAnswer = answer.trim();
    }
    flush(true);
    cleanup();
  };

  /** 终态延期收尾：先让同一 tick / 紧随其后的 chat final 更新 lastAnswer */
  const scheduleFinalize = (fallback?: string) => {
    if (cleaned) return;
    if (finalizeTimer) clearTimeout(finalizeTimer);
    finalizeTimer = setTimeout(() => {
      finalizeTimer = null;
      if (cleaned) return;
      finalize(lastAnswer.trim() || fallback);
    }, FINALIZE_DEFER_MS);
  };

  const onChat = (data: ChatMessageListenerArg) => {
    const payload = data?.message;
    const engineEvent = data?.engineEvent;
    const sessionFromEvent = payload?.sessionKey || engineEvent?.sessionKey;
    if (!isSameSessionKey(sessionFromEvent, sessionKey)) return;

    // Prefer normalized engineEvent when present (Pi turn.completed → state completed).
    if (engineEvent?.type === 'turn.completed') {
      scheduleFinalize();
      return;
    }
    if (engineEvent?.type === 'turn.failed') {
      logger.warn('[SclawDelivery] turn.failed', {
        chatUid,
        sessionKey,
        errorMessage: engineEvent.errorMessage,
      });
      scheduleFinalize(lastAnswer.trim() || engineEvent.errorMessage || '执行失败');
      return;
    }
    if (engineEvent?.type === 'turn.aborted' || engineEvent?.type === 'turn.interrupted') {
      scheduleFinalize(lastAnswer.trim() || '已中断');
      return;
    }

    if (!payload) return;
    const classified = classifyChatMessage(payload, sessionKey);
    if (!classified) return;

    if (classified.kind === 'started') {
      schedulePush();
      return;
    }

    if (classified.kind === 'fragment') {
      if (classified.answer) lastAnswer = classified.answer;
      // 过程文案整段覆盖，不要 merge 追加（否则钉钉卡会出现楼梯字）
      if (classified.status) lastStatus = classified.status;

      if (classified.state === 'final') {
        // 绝不在 final 收尾（双引擎口播 / tool 片段都会带 final）
        logger.info('[SclawDelivery] final fragment (wait agent terminal)', {
          chatUid,
          engineType,
          answerLen: lastAnswer.trim().length,
          hasStatus: Boolean(classified.status || lastStatus),
        });
        schedulePush();
        return;
      }

      if (!classified.answer && !classified.status) {
        return;
      }
      schedulePush();
      return;
    }

    // terminal: completed/done/error/aborted
    if (classified.state === 'error') {
      finalize(lastAnswer || classified.errorMessage || '执行失败');
      return;
    }
    if (classified.state === 'aborted') {
      finalize(lastAnswer || '已中断');
      return;
    }
    scheduleFinalize();
  };

  const onNotification = (notification: unknown) => {
    const classified = classifyAgentNotification(notification, sessionKey);
    if (!classified) return;

    if (classified.kind === 'tool') {
      lastStatus = `🔧 正在调用 ${classified.toolName}...`;
      schedulePush();
      return;
    }

    logger.info('[SclawDelivery] agent terminal', {
      chatUid,
      engineType,
      phase: classified.phase,
      isError: classified.isError,
    });
    scheduleFinalize(classified.isError ? '执行失败' : undefined);
  };

  const timer = setTimeout(() => {
    logger.warn('[SclawDelivery] timeout, force finalize', { sessionKey, chatUid });
    finalize(lastAnswer || '回复超时');
  }, timeoutMs);

  gatewayManager.on('chat:message', onChat);
  gatewayManager.on('notification', onNotification);
  flush(false);
  logger.info('[SclawDelivery] attached', { sessionKey, chatUid, engineType });

  return {
    detach: cleanup,
    finished,
  };
}
