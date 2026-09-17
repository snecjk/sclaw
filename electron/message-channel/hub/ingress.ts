import { randomUUID } from 'node:crypto';
import { DEFAULT_WORKSPACE_ID } from '../../db/models/domain/session-catalog';
import { getCatalogSessionRepository } from '../../db/repositories/catalog-session-repository';
import type { GatewayManager } from '../../gateway/manager';
import { upsertCatalogSession } from '../../services/session-catalog-service';
import { logger } from '../../utils/logger';
import {
  deriveChannelSessionTitle,
  isBlankOrPlaceholderChannelTitle,
} from '../common/channel-session-title';
import { getSclawHubClient, type SclawInboundEnvelope } from './hub-client';
import { attachStreamingDelivery } from './delivery';
import {
  composeInboundText,
  materializeInboundMedia,
} from './inbound-media';
import {
  createOrGetSession,
  resolveChannelBinding,
  sendViaFacade,
} from '../common/session-facade';
import { isDingTalkNewSessionCommand } from '../common/session-lifecycle';
import type { PlatformChannelType } from '../common/session-key';

let gatewayManagerRef: GatewayManager | null = null;
const peerQueues = new Map<string, Promise<void>>();

export function setChannelGatewayManager(gm: GatewayManager | null): void {
  gatewayManagerRef = gm;
}

export function getChannelGatewayManager(): GatewayManager | null {
  return gatewayManagerRef;
}

/**
 * Fill catalog title once from inbound prompt when missing/placeholder.
 * Does not overwrite a real user/engine title on续聊.
 */
export async function ensureChannelSessionTitleFromPrompt(
  sessionKey: string,
  prompt: string,
): Promise<void> {
  const title = deriveChannelSessionTitle(prompt);
  if (!title) return;

  const row = await getCatalogSessionRepository().findBySessionKey(sessionKey);
  if (!isBlankOrPlaceholderChannelTitle(row?.title)) return;

  await upsertCatalogSession({
    workspaceId: row?.workspaceId ?? DEFAULT_WORKSPACE_ID,
    sessionKey,
    title,
  });
}

function enqueuePeer(queueKey: string, task: () => Promise<void>): void {
  const prev = peerQueues.get(queueKey) ?? Promise.resolve();
  const next = prev.then(task, task).finally(() => {
    if (peerQueues.get(queueKey) === next) {
      peerQueues.delete(queueKey);
    }
  });
  peerQueues.set(queueKey, next);
}

function hasInboundContent(payload: NonNullable<SclawInboundEnvelope['payload']>): boolean {
  if (payload.action === 'new_session') return true;
  const text = payload.text?.trim() || '';
  if (text) return true;
  for (const part of payload.parts ?? []) {
    if (part?.content?.trim() || part?.url?.trim()) return true;
  }
  return false;
}

function resolveInboundChannelType(
  payload: NonNullable<SclawInboundEnvelope['payload']>,
): PlatformChannelType {
  const raw = (payload.channelType || 'dingtalk').trim().toLowerCase();
  return raw === 'mobile' ? 'mobile' : 'dingtalk';
}

/**
 * Hub inbound → SessionFacade（多模态）→ 流式回程。
 */
export function handleSclawInbound(msg: SclawInboundEnvelope): void {
  const payload = msg.payload;
  // 单聊偶发无 conversationId：退回 dingUserId，避免整轮入站被静默丢弃
  const peerId = payload?.peerId?.trim()
    || payload?.dingUserId?.trim()
    || (payload?.channelType === 'mobile' ? `mobile-${payload.chatUid || randomUUID().slice(0, 8)}` : '')
    || '';
  const chatUid = payload?.chatUid?.trim() || '';
  const channelTraceId = payload?.channelTraceId;
  const parts = payload?.parts;
  const text = composeInboundText(parts, payload?.text);
  const channelType = payload ? resolveInboundChannelType(payload) : 'dingtalk';
  const requestedSessionKey = payload?.sessionKey?.trim() || '';
  const forceNewSession =
    payload?.action === 'new_session'
    || (channelType === 'dingtalk' && isDingTalkNewSessionCommand(text))
    || (channelType === 'mobile' && !requestedSessionKey && payload?.action === 'new_session');

  if (!peerId || !chatUid || !payload || !hasInboundContent(payload)) {
    logger.warn('[SclawIngress] ignore inbound: missing peerId/content/chatUid', {
      channelTraceId,
      type: msg.type,
      hasPayload: !!payload,
      peerId: peerId || null,
      chatUid: chatUid || null,
      textLen: text.length,
      partsCount: parts?.length ?? 0,
      msgtype: payload?.msgtype ?? null,
      dingUserId: payload?.dingUserId ?? null,
      payloadKeys: payload ? Object.keys(payload) : [],
    });
    // Hub 已发卡：必须 finalize，否则钉钉卡片会一直转圈
    if (chatUid) {
      try {
        const reason = !hasInboundContent(payload ?? {})
          ? '暂不支持该消息类型，请发送文字、图片、语音或文件'
          : '入站消息不完整，请重试';
        getSclawHubClient().sendDelta(chatUid, reason, true);
      } catch {
        // ignore
      }
    }
    return;
  }

  const queueKey = channelType === 'mobile'
    ? `mobile:${requestedSessionKey || chatUid}`
    : peerId;

  enqueuePeer(queueKey, async () => {
    const gm = gatewayManagerRef;
    if (!gm) {
      logger.warn('[SclawIngress] no gatewayManager', { channelTraceId, peerId });
      return;
    }

    logger.info('[SclawIngress] handle inbound', {
      channelTraceId,
      channelType,
      peerId,
      chatUid,
      sessionKey: requestedSessionKey || null,
      textLen: text.length,
      partsCount: parts?.length ?? 0,
      msgtype: payload.msgtype ?? null,
      partSummary: (parts ?? []).map((p) => ({
        type: p.type ?? null,
        hasUrl: !!p.url?.trim(),
        hasContent: !!p.content?.trim(),
        fileName: p.fileName ?? null,
      })),
    });

    try {
      const binding = await resolveChannelBinding(channelType);
      const handle = await createOrGetSession({
        agentId: binding.agentId,
        channelType,
        peerId,
        engineType: binding.engineType,
        forceNew: forceNewSession,
        sessionKey: channelType === 'mobile' ? (requestedSessionKey || null) : null,
      });

      // 续聊排队：已有 sessionKey 后按真实 key 串行（首包用 chatUid 入队）
      if (channelType === 'mobile' && requestedSessionKey !== handle.sessionKey) {
        // no-op：本任务已在 chatUid 队列；后续同 session 用 sessionKey 队列
      }

      if (forceNewSession && channelType === 'dingtalk') {
        logger.info('[SclawIngress] started new dingtalk session', {
          channelTraceId,
          peerId,
          sessionKey: handle.sessionKey,
          source: payload.action === 'new_session' ? 'button' : 'command',
        });
        getSclawHubClient().sendDelta(
          chatUid,
          '已开启新对话，请继续发送消息。',
          true,
          { sessionKey: handle.sessionKey },
        );
        return;
      }

      const media = await materializeInboundMedia(parts, chatUid);
      if ((parts?.some((p) => p.url?.trim() && (p.type || '') !== 'text') ?? false) && media.length === 0) {
        getSclawHubClient().sendDelta(chatUid, '媒体文件下载失败，请重试或改发文字', true, {
          sessionKey: handle.sessionKey,
        });
        return;
      }

      // 纯图片/文件且无文案时给 Agent 一个最小提示，避免空 prompt
      const prompt =
        text ||
        (media.length > 0
          ? media.some((m) => m.mimeType.startsWith('image/'))
            ? '请查看图片并回答'
            : '请查看附件并回答'
          : '');

      if (!prompt && media.length === 0) {
        getSclawHubClient().sendDelta(chatUid, '暂不支持该消息类型，请发送文字、图片、语音或文件', true, {
          sessionKey: handle.sessionKey,
        });
        return;
      }

      // history.list 读 catalog_sessions.title；通道入站此前不写标题 → App 全是「新对话」
      await ensureChannelSessionTitleFromPrompt(handle.sessionKey, prompt).catch((error) => {
        logger.warn('[SclawIngress] ensure session title failed', {
          sessionKey: handle.sessionKey,
          error: String(error),
        });
      });

      const detach = attachStreamingDelivery({
        gatewayManager: gm,
        sessionKey: handle.sessionKey,
        chatUid,
        engineType: binding.engineType,
      });

      try {
        await sendViaFacade(gm, handle, prompt, media);
      } catch (error) {
        detach();
        throw error;
      }
    } catch (error) {
      logger.error('[SclawIngress] failed', {
        channelTraceId,
        peerId,
        channelType,
        error: String(error),
      });
      try {
        getSclawHubClient().sendDelta(chatUid, `处理失败：${String(error)}`, true);
      } catch {
        // ignore
      }
    }
  });
}
