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
    const echoIndex = findOptimisticUserEchoIndex(messages, optimistic);
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

function normalizeDisplayText(content: unknown): string {
  if (typeof content === 'string') return content.replace(/\s+/g, ' ').trim();
  if (!Array.isArray(content)) return '';
  return (content as Array<{ type?: string; text?: string }>)
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function findOptimisticUserEchoIndex(messages: RawMessage[], optimistic: RawMessage): number {
  const optimisticText = normalizeDisplayText(optimistic.content);
  return messages.findIndex((message) => {
    if (message.role !== 'user') return false;
    if (optimistic.id && message.id === optimistic.id) return true;
    const messageText = normalizeDisplayText(message.content);
    if (optimisticText && messageText === optimisticText) return true;
    return Boolean(
      optimistic._skillMeta
      && message._skillMeta?.slug === optimistic._skillMeta.slug
      && !optimisticText
      && !messageText,
    );
  });
}
