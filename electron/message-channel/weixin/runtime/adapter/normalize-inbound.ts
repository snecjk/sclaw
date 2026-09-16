/**
 * Normalize iLink getUpdates message → WeixinWireEvent message.inbound.
 * Text + media refs; Worker materializes media paths before posting.
 */

import type { WeixinWireEvent } from '../../../../../shared/weixin-runtime-protocol';
import { MessageItemType } from '../transport/client-v1.js';

type RawMsg = {
  from_user_id?: string;
  to_user_id?: string;
  message_id?: string | number;
  create_time_ms?: number | string;
  context_token?: string;
  item_list?: Array<{
    type?: number;
    text_item?: { text?: string };
    image_item?: unknown;
    voice_item?: { text?: string };
    file_item?: unknown;
    video_item?: unknown;
  }>;
};

function extractText(msg: RawMsg): string | undefined {
  const parts: string[] = [];
  for (const item of msg.item_list ?? []) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text?.trim()) {
      parts.push(item.text_item.text.trim());
    }
    if (item.type === MessageItemType.VOICE && item.voice_item?.text?.trim()) {
      parts.push(item.voice_item.text.trim());
    }
  }
  return parts.length ? parts.join('\n') : undefined;
}

function hasMediaPayload(msg: RawMsg): boolean {
  for (const item of msg.item_list ?? []) {
    if (
      item.type === MessageItemType.IMAGE
      || item.type === MessageItemType.FILE
      || item.type === MessageItemType.VIDEO
      || item.type === MessageItemType.VOICE
    ) {
      return true;
    }
  }
  return false;
}

export function normalizeInboundMessage(input: {
  accountId: string;
  msg: RawMsg;
  protocolVersion?: string;
}): Extract<WeixinWireEvent, { type: 'message.inbound' }> | null {
  const peerId = (input.msg.from_user_id || '').trim();
  if (!peerId) return null;

  const messageId = String(input.msg.message_id ?? `${Date.now()}`);
  const createdAtMs = Number(input.msg.create_time_ms);
  const text = extractText(input.msg);
  const media = hasMediaPayload(input.msg);

  // Skip empty non-text, non-media payloads
  if (!text && !media) return null;

  return {
    type: 'message.inbound',
    accountId: input.accountId,
    peerId,
    messageId,
    contextToken: input.msg.context_token?.trim() || undefined,
    createdAtMs: Number.isFinite(createdAtMs) && createdAtMs > 0 ? createdAtMs : Date.now(),
    text,
    rawProtocolVersion: input.protocolVersion ?? 'ilink-v1',
  };
}

export function inboundRawItemList(msg: RawMsg): RawMsg['item_list'] {
  return msg.item_list;
}
