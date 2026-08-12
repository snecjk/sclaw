import type { RawMessage } from './types';
import type { ChatMessageDecorations, ChatTurnOverlay } from './client-session-reducer';
import { findHistoryUserEcho, isSameUserMessage } from './user-message-merge';
import { toMs } from './helpers';

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
  const optimistic = overlay.optimisticUserMessage;

  if (optimistic && (!optimistic.id || !ids.has(optimistic.id))) {
    const refAt = typeof optimistic.timestamp === 'number'
      ? toMs(optimistic.timestamp)
      : 0;
    const alreadyPaired = messages.some((message) => (
      message.role === 'user'
      && (
        (optimistic.id && message.id && message.id === optimistic.id)
        || isSameUserMessage(message, optimistic, refAt)
        || Boolean(findHistoryUserEcho([message], optimistic, refAt))
      )
    ));
    if (!alreadyPaired) {
      messages.push(optimistic);
    }
  }

  if (options.includeStreaming !== false && overlay.streamingMessage
    && (!overlay.streamingMessage.id || !ids.has(overlay.streamingMessage.id))) {
    messages.push(overlay.streamingMessage);
  }
  return messages;
}
