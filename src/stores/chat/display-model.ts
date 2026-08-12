import type { RawMessage } from './types';
import type { ChatMessageDecorations, ChatTurnOverlay } from './client-session-reducer';

/**
 * Pure projection from authoritative transcript plus local, replaceable UI overlay.
 * The transcript is never mutated with optimistic or streaming records.
 */
export function buildChatDisplayModel(
  transcript: RawMessage[],
  overlay: ChatTurnOverlay,
  decorations?: ChatMessageDecorations,
  options: { includeStreaming?: boolean } = {},
): RawMessage[] {
  const messages = [...(decorations?.projectedMessages ?? transcript)];
  const ids = new Set(messages.map((message) => message.id).filter(Boolean));
  if (overlay.optimisticUserMessage && (!overlay.optimisticUserMessage.id || !ids.has(overlay.optimisticUserMessage.id))) {
    messages.push(overlay.optimisticUserMessage);
  }
  if (options.includeStreaming !== false && overlay.streamingMessage
    && (!overlay.streamingMessage.id || !ids.has(overlay.streamingMessage.id))) {
    messages.push(overlay.streamingMessage);
  }
  return messages;
}
