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
  const optimistic = overlay.optimisticUserMessage;
  let messages = [...(decorations?.projectedMessages ?? transcript)];
  if (optimistic) {
    // Session-title recovery injects a truncated plain user row. While the
    // optimistic skill/workflow turn is still on screen, that synthetic row is
    // the same send — drop it instead of showing two bubbles.
    messages = messages.filter((message) => !isSyntheticSessionLabelUser(message));
  }

  const ids = new Set(messages.map((message) => message.id).filter(Boolean));

  if (optimistic && (!optimistic.id || !ids.has(optimistic.id))) {
    const refAt = typeof optimistic.timestamp === 'number'
      ? toMs(optimistic.timestamp)
      : 0;
    const echoIndex = messages.findIndex((message) => (
      message.role === 'user'
      && (
        (optimistic.id && message.id && message.id === optimistic.id)
        || isSameUserMessage(message, optimistic, refAt)
        || Boolean(findHistoryUserEcho([message], optimistic, refAt))
      )
    ));
    if (echoIndex >= 0) {
      if (optimistic._skillMeta && !messages[echoIndex]._skillMeta) {
        messages = messages.map((message, index) => (
          index === echoIndex
            ? {
                ...message,
                _skillMeta: optimistic._skillMeta,
                content: optimistic.content ?? message.content,
              }
            : message
        ));
      }
    } else {
      messages.push(optimistic);
    }
  }

  if (options.includeStreaming !== false && overlay.streamingMessage
    && (!overlay.streamingMessage.id || !ids.has(overlay.streamingMessage.id))) {
    messages.push(overlay.streamingMessage);
  }
  return messages;
}

function isSyntheticSessionLabelUser(message: RawMessage): boolean {
  return typeof message.id === 'string' && message.id.startsWith('session-label-user-');
}
