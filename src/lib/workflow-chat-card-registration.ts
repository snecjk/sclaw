import { registerChatWorkflowCard } from '@/lib/workflow-api';
import { useChatStore } from '@/stores/chat';
import { refreshWorkflowChatCards } from '@/stores/workflow-chat-cards';
import type { RawMessage } from '@/stores/chat/types';
import type { ChatWorkflowCardRef } from '@/types/workflow';
import { useChatRuntimeV2Store } from '@/stores/chat/runtime-v2-store';

function timestampMs(value: RawMessage['timestamp']): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1_000 : value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function latestUserMessageId(sessionKey: string): string | null {
  const state = useChatStore.getState();
  if (state.currentSessionKey !== sessionKey) return null;
  const optimistic = useChatRuntimeV2Store.getState().sessionsByKey[sessionKey]?.overlay.optimisticUserMessage;
  if (optimistic?.id) return optimistic.id;
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];
    if (message.role === 'user' && message.id) return message.id;
  }
  return null;
}

export async function registerStartedWorkflowChatCard(input: {
  runId: string;
  sessionKey: string;
  title: string;
  paramsSummary?: string | null;
  anchorUserMessageId?: string | null;
}): Promise<boolean> {
  const metadata = {
    runId: input.runId,
    sessionKey: input.sessionKey,
    anchorUserMessageId: input.anchorUserMessageId ?? latestUserMessageId(input.sessionKey),
    title: input.title,
    paramsSummary: input.paramsSummary,
  };
  try {
    const registered = await registerChatWorkflowCard(metadata);
    if (registered) await refreshWorkflowChatCards(input.sessionKey);
    return registered;
  } catch (error) {
    console.warn('[workflow-chat-card] registration failed', {
      runId: input.runId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** Enrich visible standalone refs after durable history supplies message IDs. */
export async function attachMissingWorkflowChatCardAnchors(input: {
  sessionKey: string;
  messages: RawMessage[];
  cards: ChatWorkflowCardRef[];
}): Promise<void> {
  let changed = false;
  for (const card of input.cards) {
    if (card.anchorUserMessageId) continue;
    const startedAt = Date.parse(card.startedAt);
    if (!Number.isFinite(startedAt)) continue;

    let anchorId: string | null = null;
    let anchorAt = Number.NEGATIVE_INFINITY;
    for (const message of input.messages) {
      if (message.role !== 'user' || !message.id) continue;
      const at = timestampMs(message.timestamp);
      if (at != null && at <= startedAt && at >= anchorAt) {
        anchorId = message.id;
        anchorAt = at;
      }
    }
    if (!anchorId) continue;
    const registered = await registerChatWorkflowCard({
      runId: card.runId,
      sessionKey: input.sessionKey,
      anchorUserMessageId: anchorId,
      title: card.title,
      paramsSummary: card.paramsSummary,
    });
    changed ||= registered;
  }
  if (changed) await refreshWorkflowChatCards(input.sessionKey);
}
