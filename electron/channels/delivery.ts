import type { GatewayManager } from '../gateway/manager';
import { logger } from '../utils/logger';
import { hubReplyStream } from './hub-api';
import { getSclawHubClient } from './hub-client';

const STATUS_MAX_CHARS = 3500;
const MIN_PUSH_INTERVAL_MS = 450;

/** 拆出正文与过程；过程只用于尚无正文时占位，finalize 时会被正文覆盖。 */
function extractAssistantParts(message: unknown): { answer: string; status: string } {
  if (!message || typeof message !== 'object') {
    return { answer: '', status: '' };
  }
  const record = message as { content?: unknown; text?: unknown };
  const raw = record.content;
  if (typeof raw === 'string') {
    return { answer: raw, status: '' };
  }
  if (!Array.isArray(raw)) {
    // OpenClaw 部分帧用顶层 text，而不是 content[]
    if (typeof record.text === 'string' && record.text) {
      return { answer: record.text, status: '' };
    }
    return { answer: '', status: '' };
  }

  const texts: string[] = [];
  const statuses: string[] = [];

  for (const block of raw) {
    if (!block || typeof block !== 'object') continue;
    const item = block as {
      type?: string;
      text?: string;
      thinking?: string;
      name?: string;
    };
    // 仅 type=thinking 才当过程态；不要用 `thinking` 字段存在与否误伤 text 块
    if (item.type === 'thinking') {
      if (typeof item.thinking === 'string' && item.thinking.trim()) {
        statuses.push(item.thinking.trim());
      }
      continue;
    }
    if (item.type === 'tool_use' || item.type === 'toolCall') {
      const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : '工具';
      statuses.push(`🔧 正在调用 ${name}...`);
      continue;
    }
    if (typeof item.text === 'string' && item.text) {
      texts.push(item.text);
    }
  }

  if (texts.length === 0 && typeof record.text === 'string' && record.text) {
    return { answer: record.text, status: statuses.join('\n\n').slice(0, STATUS_MAX_CHARS) };
  }

  return {
    answer: texts.join(''),
    status: statuses.join('\n\n').slice(0, STATUS_MAX_CHARS),
  };
}

function sameSessionKey(left: string | undefined, right: string): boolean {
  if (!left) return false;
  return left === right || left.toLowerCase() === right.toLowerCase();
}

function pushReply(chatUid: string, content: string, finalize: boolean): void {
  const client = getSclawHubClient();
  const ok = client.sendDelta(chatUid, content, finalize);
  if (ok) {
    logger.info('[SclawDelivery] ws reply', {
      chatUid,
      finalize,
      contentLen: content.length,
    });
    if (finalize) {
      void hubReplyStream({ chatUid, content, finalize: true }).catch((error) => {
        logger.warn('[SclawDelivery] HTTP finalize backup failed', error);
      });
    }
    return;
  }
  logger.warn('[SclawDelivery] ws not connected, HTTP reply', { chatUid, finalize });
  void hubReplyStream({ chatUid, content, finalize }).catch((error) => {
    logger.warn('[SclawDelivery] HTTP reply fallback failed', error);
  });
}

/**
 * 全程只更新钉钉卡片 content：
 * - 过程中：尚无正文时用思考/工具状态占位，卡片在动
 * - 结束后：只推完整回答，覆盖过程文案
 *
 * 终态语义（与页面 run-completion 对齐，不可再拆成引擎分支收尾）：
 * 1) chat.state=final 一律当片段：工具前口播 / tool_use / 真答案都可能带 final；
 *    绝不能在此 finalize（否则截口播，或空 final →「无回复内容」）。
 * 2) 真正收尾只认 agent 终态：
 *    - Claude：顶层 phase=completed（adapter 在 result 后发出）
 *    - OpenClaw：data.phase=end|error（stream=lifecycle）；工具事件也有 data.phase，
 *      但 stream=tool，必须先过滤，不能把 tool end 当成整轮结束。
 * 3) OpenClaw 常先广播 lifecycle end、再 emit 尾部 chat；终态后短暂延期再 finalize，
 *    避免听筒已卸、丢最后一段正文。
 */
export function attachStreamingDelivery(input: {
  gatewayManager: GatewayManager;
  sessionKey: string;
  chatUid: string;
  engineType?: 'claude' | 'openclaw';
  timeoutMs?: number;
}): () => void {
  const { gatewayManager, sessionKey, chatUid } = input;
  const engineType = input.engineType === 'openclaw' ? 'openclaw' : 'claude';
  const timeoutMs = input.timeoutMs ?? 10 * 60 * 1000;
  let lastAnswer = '';
  let lastStatus = '正在分析你的问题...';
  let lastSent = '';
  let lastPushAt = 0;
  let cleaned = false;
  let pendingTimer: NodeJS.Timeout | null = null;
  let finalizeTimer: NodeJS.Timeout | null = null;
  /** OpenClaw lifecycle end → 尾部 chat 的缓冲窗 */
  const FINALIZE_DEFER_MS = 150;

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
  };

  const flush = (finalize: boolean) => {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    const content = visibleContent(finalize);
    if (!finalize && content === lastSent) return;
    lastSent = content;
    lastPushAt = Date.now();
    pushReply(chatUid, content, finalize);
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

  const onChat = (data: { message: unknown }) => {
    const payload = data?.message as {
      sessionKey?: string;
      state?: string;
      errorMessage?: string;
      message?: unknown;
    } | undefined;
    if (!payload || !sameSessionKey(payload.sessionKey, sessionKey)) return;

    if (payload.state === 'started') {
      schedulePush();
      return;
    }

    if (payload.state === 'delta' || payload.state === 'final') {
      const parts = extractAssistantParts(payload.message);
      if (parts.answer) lastAnswer = parts.answer;
      // 过程文案整段覆盖，不要 merge 追加（否则钉钉卡会出现楼梯字）
      if (parts.status) lastStatus = parts.status;

      if (payload.state === 'final') {
        // 绝不在 final 收尾（双引擎口播 / tool 片段都会带 final）
        logger.info('[SclawDelivery] final fragment (wait agent terminal)', {
          chatUid,
          engineType,
          answerLen: lastAnswer.trim().length,
          hasStatus: Boolean(parts.status || lastStatus),
        });
        schedulePush();
        return;
      }

      if (!parts.answer && !parts.status) {
        return;
      }
      schedulePush();
      return;
    }

    // OpenClaw lifecycle 后偶发 state=done（与 agent end 同源终态）
    if (payload.state === 'done') {
      scheduleFinalize();
      return;
    }

    if (payload.state === 'error') {
      finalize(lastAnswer || payload.errorMessage || '执行失败');
      return;
    }
    if (payload.state === 'aborted') {
      finalize(lastAnswer || '已中断');
    }
  };

  const onNotification = (notification: {
    method?: string;
    params?: {
      phase?: string;
      stream?: string;
      sessionKey?: string;
      data?: { phase?: string; name?: string; toolName?: string };
      name?: string;
    };
  }) => {
    if (notification?.method !== 'agent') return;
    const params = notification.params;
    if (!params || !sameSessionKey(params.sessionKey, sessionKey)) return;

    // 与页面 gateway.ts 一致：OpenClaw phase 在 data.phase；Claude 在顶层 phase
    const data = params.data && typeof params.data === 'object' ? params.data : undefined;
    const phase = String(data?.phase ?? params.phase ?? '').toLowerCase();
    const stream = String(params.stream ?? '').toLowerCase();

    // 工具事件也带 data.phase=start|end，必须靠 stream=tool 排除，否则会误 finalize
    if (
      stream === 'tool'
      || phase === 'tool'
      || phase === 'tool_start'
      || phase === 'tool_call'
    ) {
      const toolName = data?.name
        || data?.toolName
        || params.name
        || '工具';
      lastStatus = `🔧 正在调用 ${toolName}...`;
      schedulePush();
      return;
    }

    if (
      phase === 'completed'
      || phase === 'done'
      || phase === 'finished'
      || phase === 'end'
    ) {
      logger.info('[SclawDelivery] agent terminal', { chatUid, engineType, phase, stream });
      scheduleFinalize();
      return;
    }

    if (phase === 'error') {
      logger.info('[SclawDelivery] agent terminal', { chatUid, engineType, phase, stream });
      scheduleFinalize('执行失败');
    }
  };

  const timer = setTimeout(() => {
    logger.warn('[SclawDelivery] timeout, force finalize', { sessionKey, chatUid });
    finalize(lastAnswer || '回复超时');
  }, timeoutMs);

  gatewayManager.on('chat:message', onChat);
  gatewayManager.on('notification', onNotification);
  flush(false);
  logger.info('[SclawDelivery] attached (content-only)', { sessionKey, chatUid, engineType });

  return cleanup;
}
