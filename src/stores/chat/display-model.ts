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
      const echo = messages[echoIndex];
      const needsSkillPatch = Boolean(optimistic._skillMeta && !echo._skillMeta);
      const needsComposerPatch = Boolean(
        optimistic._composerSegments?.length
        && !echo._composerSegments?.length,
      );
      if (needsSkillPatch || needsComposerPatch) {
        messages = messages.map((message, index) => (
          index === echoIndex
            ? {
                ...message,
                _skillMeta: optimistic._skillMeta ?? message._skillMeta,
                _skillMetas: optimistic._skillMetas ?? message._skillMetas,
                _composerSegments: optimistic._composerSegments ?? message._composerSegments,
                _attachedFiles: optimistic._attachedFiles ?? message._attachedFiles,
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

/**
 * Freeze a completed, transcript-pending turn into the display projection
 * before the next optimistic turn replaces the single active overlay slot.
 * The authoritative transcript remains untouched and a later history refresh
 * can reconcile/replace this display-only snapshot.
 */
export function materializeCompletedOverlay(
  transcript: RawMessage[],
  overlay: ChatTurnOverlay,
  decorations?: ChatMessageDecorations,
): RawMessage[] {
  const messages = buildChatDisplayModel(
    transcript,
    overlay,
    decorations,
    { includeStreaming: false },
  );
  const overlayMessages = [
    ...overlay.streamingMessages,
    ...overlay.streamingToolResults,
  ].map((message, index) => ({ message, index }));

  overlayMessages.sort((left, right) => {
    const leftAt = typeof left.message.timestamp === 'number' ? toMs(left.message.timestamp) : null;
    const rightAt = typeof right.message.timestamp === 'number' ? toMs(right.message.timestamp) : null;
    if (leftAt !== null && rightAt !== null && leftAt !== rightAt) return leftAt - rightAt;
    return left.index - right.index;
  });

  const upsert = (message: RawMessage) => {
    const existingIndex = message.id
      ? messages.findIndex((candidate) => candidate.id === message.id)
      : -1;
    if (existingIndex >= 0) {
      messages[existingIndex] = message;
      return;
    }
    if (!message.id && messages.includes(message)) return;
    messages.push(message);
  };

  for (const entry of overlayMessages) upsert(entry.message);
  if (overlay.streamingMessage) upsert(overlay.streamingMessage);
  return messages;
}

function isSyntheticSessionLabelUser(message: RawMessage): boolean {
  return typeof message.id === 'string' && message.id.startsWith('session-label-user-');
}
