/**
 * Engine stream → Worker outbound: typing (~3s) + commit (final) + cancel.
 * Does NOT reuse DingTalk card-overwrite delivery.
 *
 * Pi emits turn.completed → legacy chat:message state=`completed`
 * (not `done`). Missing that caused perpetual WeChat "正在输入…".
 */

import type { GatewayManager } from '../../gateway/manager';
import type { NormalizedEngineEvent } from '../../gateway/normalized-engine-event';
import { logger } from '../../utils/logger';
import { extractOutboundMediaFromAnswer } from './extract-outbound-media';
import type { WeixinChannelService } from './service';

const TYPING_INTERVAL_MS = 3_000;
const FINALIZE_DEFER_MS = 150;

function sameSessionKey(left: string | undefined, right: string): boolean {
  if (!left) return false;
  return left === right || left.toLowerCase() === right.toLowerCase();
}

function extractAssistantAnswer(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const record = message as { content?: unknown; text?: unknown };
  if (typeof record.text === 'string' && record.text.trim()) return record.text;
  const raw = record.content;
  if (typeof raw === 'string') return raw;
  if (!Array.isArray(raw)) return '';
  const texts: string[] = [];
  for (const block of raw) {
    if (!block || typeof block !== 'object') continue;
    const item = block as { type?: string; text?: string };
    if (item.type === 'thinking' || item.type === 'tool_use' || item.type === 'toolCall') continue;
    if (typeof item.text === 'string' && item.text) texts.push(item.text);
  }
  return texts.join('');
}

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
 * Subscribe to GatewayManager chat events for one Weixin session run.
 * Returns a detach function.
 */
export function attachWeixinOutbound(input: {
  gatewayManager: GatewayManager;
  weixinService: WeixinChannelService;
  sessionKey: string;
  peerId: string;
  contextToken?: string;
  timeoutMs?: number;
}): () => void {
  const { gatewayManager, weixinService, sessionKey, peerId } = input;
  const timeoutMs = input.timeoutMs ?? 10 * 60 * 1000;
  let lastAnswer = '';
  let cleaned = false;
  let typingTimer: NodeJS.Timeout | null = null;
  let finalizeTimer: NodeJS.Timeout | null = null;
  const contextToken = input.contextToken;

  const sendTyping = () => {
    weixinService.sendCommand({
      type: 'outbound.typing',
      peerId,
      contextToken,
    });
  };

  const stopTypingPulse = () => {
    if (typingTimer) {
      clearInterval(typingTimer);
      typingTimer = null;
    }
  };

  const cancelWeixinTyping = () => {
    stopTypingPulse();
    weixinService.sendCommand({
      type: 'outbound.cancel',
      peerId,
    });
  };

  const startTyping = () => {
    stopTypingPulse();
    sendTyping();
    typingTimer = setInterval(sendTyping, TYPING_INTERVAL_MS);
  };

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    stopTypingPulse();
    clearTimeout(timer);
    if (finalizeTimer) clearTimeout(finalizeTimer);
    gatewayManager.off('chat:message', onChat);
    gatewayManager.off('notification', onNotification);
  };

  const commit = (answer?: string) => {
    if (cleaned) return;
    const raw = (typeof answer === 'string' && answer.trim() ? answer : lastAnswer).trim();
    const { text: cleanedText, filePaths } = extractOutboundMediaFromAnswer(raw);
    const text = cleanedText.trim() || (filePaths.length ? '' : '（无回复内容）');
    stopTypingPulse();
    logger.info('[WeixinOutbound] commit', {
      sessionKey,
      peerId,
      textLen: text.length,
      mediaCount: filePaths.length,
    });
    if (text) {
      weixinService.sendCommand({
        type: 'outbound.commit',
        peerId,
        text,
        contextToken,
        clientRequestId: `commit:${sessionKey}:${Date.now()}`,
      });
    }
    for (let i = 0; i < filePaths.length; i += 1) {
      const filePath = filePaths[i];
      weixinService.sendCommand({
        type: 'outbound.sendMedia',
        peerId,
        filePath,
        contextToken,
        clientRequestId: `media:${sessionKey}:${i}:${Date.now()}`,
      });
    }
    if (!text && filePaths.length === 0) {
      weixinService.sendCommand({
        type: 'outbound.commit',
        peerId,
        text: '（无回复内容）',
        contextToken,
        clientRequestId: `commit:${sessionKey}:${Date.now()}`,
      });
    }
    // Typing CANCEL is sent by the worker after a successful commit/sendMedia.
    cleanup();
  };

  const scheduleCommit = (fallback?: string) => {
    if (cleaned) return;
    if (finalizeTimer) clearTimeout(finalizeTimer);
    finalizeTimer = setTimeout(() => {
      finalizeTimer = null;
      commit(lastAnswer.trim() || fallback);
    }, FINALIZE_DEFER_MS);
  };

  const onChat = (data: ChatMessageListenerArg) => {
    const payload = data?.message;
    const engineEvent = data?.engineEvent;
    const sessionFromEvent = payload?.sessionKey || engineEvent?.sessionKey;
    if (!sameSessionKey(sessionFromEvent, sessionKey)) return;

    // Prefer normalized engineEvent when present (Pi turn.completed → state completed).
    if (engineEvent?.type === 'turn.completed') {
      scheduleCommit();
      return;
    }
    if (engineEvent?.type === 'turn.failed') {
      lastAnswer = lastAnswer.trim() || engineEvent.errorMessage || '处理失败';
      scheduleCommit();
      return;
    }
    if (engineEvent?.type === 'turn.aborted' || engineEvent?.type === 'turn.interrupted') {
      scheduleCommit(lastAnswer.trim() || '已中断');
      return;
    }

    if (!payload) return;

    if (payload.state === 'started') {
      startTyping();
      return;
    }

    if (payload.state === 'delta' || payload.state === 'final') {
      const answer = extractAssistantAnswer(payload.message);
      if (answer) lastAnswer = answer;
      if (!typingTimer) startTyping();
      return;
    }

    // Pi: completed | Claude/OC legacy: done | errors
    if (
      payload.state === 'completed'
      || payload.state === 'done'
      || payload.state === 'error'
      || payload.state === 'aborted'
    ) {
      if (payload.state === 'error' && payload.errorMessage) {
        lastAnswer = lastAnswer.trim() || `处理失败：${payload.errorMessage}`;
      }
      scheduleCommit();
    }
  };

  const onNotification = (data: unknown) => {
    const payload = data as {
      method?: string;
      sessionKey?: string;
      phase?: string;
      params?: { sessionKey?: string; phase?: string; data?: { phase?: string } };
      data?: { phase?: string; stream?: string };
    } | undefined;
    if (!payload) return;
    const sessionFromNote =
      payload.sessionKey
      || payload.params?.sessionKey;
    if (!sameSessionKey(sessionFromNote, sessionKey)) return;
    const phase = String(
      payload.phase
        || payload.params?.phase
        || payload.params?.data?.phase
        || payload.data?.phase
        || '',
    ).toLowerCase();
    if (phase === 'completed' || phase === 'end' || phase === 'done' || phase === 'finished') {
      scheduleCommit();
      return;
    }
    if (phase === 'error') {
      scheduleCommit(lastAnswer.trim() || '处理失败');
    }
  };

  const timer = setTimeout(() => {
    logger.warn('[WeixinOutbound] timeout; committing partial answer', { sessionKey, peerId });
    commit();
  }, timeoutMs);

  gatewayManager.on('chat:message', onChat);
  gatewayManager.on('notification', onNotification);
  startTyping();
  logger.info('[WeixinOutbound] attached', { sessionKey, peerId, hasContextToken: Boolean(contextToken) });

  return () => {
    if (cleaned) return;
    cancelWeixinTyping();
    cleanup();
  };
}
