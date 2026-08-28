import { createFlowCardBlock, isFlowCardContentBlock } from '../../shared/flow-card-protocol';
import {
  findFlowCardFenceInMessage,
  stripFlowCardFences,
  FLOW_CARD_FENCE_REGEX,
} from '@/lib/flow-card-marker';
import { setActiveFlowCardId } from '@/lib/flow-card-patch';
import { getSessionDisplayMessages, updateSessionDisplayProjection } from '@/stores/chat/display-selectors';
import { buildChatDisplayModel } from '@/stores/chat/display-model';
import { createClientSessionState } from '@/stores/chat/client-session-reducer';
import { useChatRuntimeV2Store } from '@/stores/chat/runtime-v2-store';
import type { ContentBlock, RawMessage } from '@/stores/chat/types';

function messageHasFlowCardBlock(message: RawMessage): boolean {
  return Array.isArray(message.content)
    && (message.content as ContentBlock[]).some((block) => isFlowCardContentBlock(block));
}

function materializeMessage(message: RawMessage): RawMessage | null {
  if (message.role !== 'assistant') return null;
  if (messageHasFlowCardBlock(message)) return null;

  const payload = findFlowCardFenceInMessage(message.content);
  if (!payload) return null;

  const introBlocks: ContentBlock[] = [];
  if (Array.isArray(message.content)) {
    for (const block of message.content as ContentBlock[]) {
      if (block.type !== 'text' || typeof block.text !== 'string') {
        introBlocks.push(block);
        continue;
      }
      if (!FLOW_CARD_FENCE_REGEX.test(block.text)) {
        introBlocks.push(block);
        FLOW_CARD_FENCE_REGEX.lastIndex = 0;
        continue;
      }
      FLOW_CARD_FENCE_REGEX.lastIndex = 0;
      const stripped = stripFlowCardFences(block.text);
      if (stripped) introBlocks.push({ type: 'text', text: stripped });
    }
  } else if (typeof message.content === 'string') {
    const stripped = stripFlowCardFences(message.content);
    if (stripped) introBlocks.push({ type: 'text', text: stripped });
  }

  return {
    ...message,
    content: [...introBlocks, createFlowCardBlock(payload)],
  };
}

export function hasUnmaterializedFlowCard(message: RawMessage): boolean {
  return materializeMessage(message) !== null;
}

/** Stable signature for messages that still need fence → block materialization. */
export function buildFlowCardMaterializeSignature(sessionKey: string): string {
  const session = useChatRuntimeV2Store.getState().sessionsByKey[sessionKey]
    ?? createClientSessionState();
  const messages = buildChatDisplayModel(
    session.transcript,
    session.overlay,
    session.decorations,
    { includeStreaming: true },
  );

  const parts: string[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    if (messageHasFlowCardBlock(message)) continue;
    if (!findFlowCardFenceInMessage(message.content)) continue;
    parts.push(`${message.id ?? 'no-id'}:${message.timestamp ?? 0}`);
  }
  return parts.join('|');
}

/** Convert ```flow_card fences in assistant messages into native flow_card blocks. */
export function materializeFlowCardsInSession(sessionKey: string): boolean {
  const current = getSessionDisplayMessages(sessionKey);
  let activeCardId: string | null = null;
  let changed = false;

  const next = current.map((message) => {
    const materialized = materializeMessage(message);
    if (!materialized) return message;
    changed = true;
    const card = (materialized.content as ContentBlock[]).find((block) => isFlowCardContentBlock(block));
    if (card?.cardId) activeCardId = card.cardId;
    return materialized;
  });

  if (!changed) return false;

  if (activeCardId) setActiveFlowCardId(sessionKey, activeCardId);
  updateSessionDisplayProjection(sessionKey, () => next);
  return true;
}
