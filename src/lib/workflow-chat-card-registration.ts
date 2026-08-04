import { registerChatWorkflowCard } from '@/lib/workflow-api';
import { refreshWorkflowChatCards } from '@/stores/workflow-chat-cards';
import type { RawMessage } from '@/stores/chat/types';
import type { ChatWorkflowCardRef } from '@/types/workflow';

const anchorRepairInFlight = new Set<string>();

export function workflowAnchorRepairRevision(
  messages: RawMessage[],
  cards: ChatWorkflowCardRef[],
): string {
  const missingCards = cards
    .filter((card) => !card.anchorUserMessageId)
    .map((card) => `${card.runId}:${card.startedAt}`)
    .join('|');
  if (!missingCards) return '';
  const users = messages
    .filter((message) => message.role === 'user' && message.id)
    .map((message) => `${message.id}:${String(message.timestamp ?? '')}`)
    .join('|');
  return `${missingCards}\u0000${users}`;
}

function timestampMs(value: RawMessage['timestamp']): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1_000 : value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Enrich visible standalone refs after durable history supplies message IDs. */
export async function attachMissingWorkflowChatCardAnchors(input: {
  sessionKey: string;
  messages: RawMessage[];
  cards: ChatWorkflowCardRef[];
}): Promise<void> {
  const operationKey = `${input.sessionKey}\u0000${workflowAnchorRepairRevision(input.messages, input.cards)}`;
  if (anchorRepairInFlight.has(operationKey)) return;
  anchorRepairInFlight.add(operationKey);
  try {
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
  } finally {
    anchorRepairInFlight.delete(operationKey);
  }
}
