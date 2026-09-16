/**
 * Wire inbound → session-facade (bound engine) → Weixin typing/commit outbound.
 */

import type { GatewayManager } from '../../gateway/manager';
import {
  ensureChannelSessionTitleFromPrompt,
  getChannelGatewayManager,
} from '../hub/ingress';
import {
  createOrGetSession,
  sendViaFacade,
} from '../common/session-facade';
import { isDingTalkNewSessionCommand } from '../common/session-lifecycle';
import { logger } from '../../utils/logger';
import { getWeixinBinding } from './binding';
import { attachWeixinOutbound } from './bridge-outbound';
import type { WeixinChannelService } from './service';
import type { WeixinInboundPart, WeixinWireEvent } from '../../../shared/weixin-runtime-protocol';

const peerQueues = new Map<string, Promise<void>>();

function enqueuePeer(peerId: string, task: () => Promise<void>): void {
  const prev = peerQueues.get(peerId) ?? Promise.resolve();
  const next = prev.then(task, task).finally(() => {
    if (peerQueues.get(peerId) === next) peerQueues.delete(peerId);
  });
  peerQueues.set(peerId, next);
}

function partsToFacadeMedia(parts: WeixinInboundPart[] | undefined): Array<{
  filePath: string;
  mimeType: string;
  fileName: string;
}> {
  if (!parts?.length) return [];
  const out: Array<{ filePath: string; mimeType: string; fileName: string }> = [];
  for (const part of parts) {
    if (!part.localPath) continue;
    if (part.kind !== 'image' && part.kind !== 'file' && part.kind !== 'video') continue;
    out.push({
      filePath: part.localPath,
      mimeType: part.mimeType || 'application/octet-stream',
      fileName: part.fileName || part.localPath.split(/[\\/]/).pop() || 'file.bin',
    });
  }
  return out;
}

function buildInboundPrompt(text: string, parts: WeixinInboundPart[] | undefined): string {
  const notices = (parts ?? [])
    .filter((p) => p.notice && !p.localPath)
    .map((p) => p.notice!.trim())
    .filter(Boolean);
  const chunks = [text.trim(), ...notices].filter(Boolean);
  if (chunks.length) return chunks.join('\n');
  if (partsToFacadeMedia(parts).length) return '[用户发送了媒体附件]';
  return '';
}

export function handleWeixinWireEvent(
  weixinService: WeixinChannelService,
  event: WeixinWireEvent,
  gatewayManager?: GatewayManager | null,
): void {
  if (event.type === 'message.inbound') {
    handleWeixinInbound(weixinService, event, gatewayManager);
    return;
  }
  if (event.type === 'account.status') {
    logger.info('[WeixinBridge] account.status', {
      status: event.status,
      accountId: event.accountId,
      reasonCode: event.reasonCode,
      message: event.message,
    });
    return;
  }
  if (event.type === 'outbound.result' && !event.ok) {
    logger.warn('[WeixinBridge] outbound.result failed', {
      message: event.message,
      reasonCode: event.reasonCode,
      clientRequestId: event.clientRequestId,
    });
  }
}

function handleWeixinInbound(
  weixinService: WeixinChannelService,
  event: Extract<WeixinWireEvent, { type: 'message.inbound' }>,
  gatewayManager?: GatewayManager | null,
): void {
  const peerId = event.peerId.trim();
  const media = partsToFacadeMedia(event.parts);
  const prompt = buildInboundPrompt(event.text || '', event.parts);
  if (!peerId || (!prompt && media.length === 0)) {
    logger.warn('[WeixinBridge] ignore inbound: missing peerId/content');
    return;
  }

  enqueuePeer(peerId, async () => {
    const gm = gatewayManager ?? getChannelGatewayManager();
    if (!gm) {
      logger.warn('[WeixinBridge] no gatewayManager', { peerId });
      return;
    }

    logger.info('[WeixinBridge] inbound', {
      peerId,
      messageId: event.messageId,
      textLen: prompt.length,
      mediaCount: media.length,
      hasContextToken: Boolean(event.contextToken),
    });

    try {
      const binding = await getWeixinBinding();
      if (!binding) {
        throw new Error('WeChat bot is not bound');
      }

      const forceNew = isDingTalkNewSessionCommand(prompt);
      const handle = await createOrGetSession({
        agentId: binding.agentId,
        channelType: 'wechat',
        peerId,
        engineType: binding.engineType,
        forceNew,
      });

      if (forceNew) {
        logger.info('[WeixinBridge] started new wechat session', {
          peerId,
          sessionKey: handle.sessionKey,
        });
        weixinService.sendCommand({
          type: 'outbound.commit',
          peerId,
          text: '已开启新对话，请继续发送消息。',
          contextToken: event.contextToken,
          clientRequestId: `new-session:${handle.sessionKey}`,
        });
        return;
      }

      await ensureChannelSessionTitleFromPrompt(handle.sessionKey, prompt || '[媒体]').catch((error) => {
        logger.warn('[WeixinBridge] ensure session title failed', {
          sessionKey: handle.sessionKey,
          error: String(error),
        });
      });

      const detach = attachWeixinOutbound({
        gatewayManager: gm,
        weixinService,
        sessionKey: handle.sessionKey,
        peerId,
        contextToken: event.contextToken,
      });

      try {
        await sendViaFacade(gm, handle, prompt || '[用户发送了媒体附件]', media.length ? media : undefined);
      } catch (error) {
        detach();
        throw error;
      }
    } catch (error) {
      logger.error('[WeixinBridge] inbound failed', { peerId, error: String(error) });
      weixinService.sendCommand({
        type: 'outbound.commit',
        peerId,
        text: `处理失败：${String(error)}`,
        contextToken: event.contextToken,
        clientRequestId: `error:${peerId}:${Date.now()}`,
      });
    }
  });
}
