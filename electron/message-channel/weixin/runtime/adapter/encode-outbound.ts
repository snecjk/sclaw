/**
 * Encode WeixinWireCommand outbound → iLink API calls.
 */

import {
  MessageItemType,
  MessageState,
  MessageType,
  TypingStatus,
  getConfig,
  sendMessage,
  sendTyping,
  type WeixinApiOptions,
} from '../transport/client-v1.js';

export async function encodeAndSendTyping(input: {
  api: WeixinApiOptions;
  peerId: string;
  typingTicket?: string;
  contextToken?: string;
}): Promise<{ sent: boolean; reason?: string; typingTicket?: string }> {
  let ticket = input.typingTicket?.trim();
  if (!ticket) {
    try {
      const cfg = await getConfig({
        ...input.api,
        ilinkUserId: input.peerId,
        contextToken: input.contextToken,
      });
      ticket = cfg.typing_ticket?.trim();
    } catch {
      return { sent: false, reason: 'typing_ticket_unavailable' };
    }
  }
  if (!ticket) return { sent: false, reason: 'typing_ticket_missing' };

  await sendTyping({
    ...input.api,
    body: {
      ilink_user_id: input.peerId,
      typing_ticket: ticket,
      status: TypingStatus.TYPING,
    },
  });
  return { sent: true, typingTicket: ticket };
}

export async function encodeAndCancelTyping(input: {
  api: WeixinApiOptions;
  peerId: string;
  typingTicket?: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const ticket = input.typingTicket?.trim();
  if (!ticket) return { sent: false, reason: 'typing_ticket_missing' };
  await sendTyping({
    ...input.api,
    body: {
      ilink_user_id: input.peerId,
      typing_ticket: ticket,
      status: TypingStatus.CANCEL,
    },
  });
  return { sent: true };
}

export async function encodeAndCommitText(input: {
  api: WeixinApiOptions;
  peerId: string;
  text: string;
  contextToken?: string;
  clientRequestId?: string;
}): Promise<{ messageId?: string }> {
  const text = input.text.trim() || '（无回复内容）';
  if (!input.contextToken) {
    console.warn('[weixin-worker] CONTEXT_MISSING: committing without contextToken');
  }
  const resp = await sendMessage({
    ...input.api,
    body: {
      msg: {
        from_user_id: '',
        to_user_id: input.peerId,
        client_id: input.clientRequestId || `stoclaw-weixin:${Date.now()}`,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        item_list: [{ type: MessageItemType.TEXT, text_item: { text } }],
        context_token: input.contextToken,
      },
    },
  });
  return { messageId: resp.message_id != null ? String(resp.message_id) : undefined };
}
