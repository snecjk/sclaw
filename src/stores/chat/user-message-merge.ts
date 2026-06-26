import { getMessageText, toMs } from './helpers';
import type { RawMessage } from './types';

export function normalizeUserMessageText(content: unknown): string {
  return getMessageText(content)
    .replace(/\s+/g, ' ')
    .trim();
}

function getAttachmentKeys(message: RawMessage): string[] {
  return (message._attachedFiles ?? [])
    .map((file) => file.filePath || file.fileName)
    .filter(Boolean)
    .sort();
}

function attachmentsMatch(a: RawMessage, b: RawMessage): boolean {
  const aKeys = getAttachmentKeys(a);
  const bKeys = getAttachmentKeys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key, index) => key === bKeys[index]);
}

export function isSameUserMessage(
  candidate: RawMessage,
  optimistic: RawMessage,
  userMessageAt: number,
): boolean {
  if (candidate.role !== 'user') return false;
  if (candidate.id && optimistic.id && candidate.id === optimistic.id) return true;

  const candidateText = normalizeUserMessageText(candidate.content);
  const optimisticText = normalizeUserMessageText(optimistic.content);
  const textMatches = candidateText.length > 0
    && candidateText === optimisticText
    && attachmentsMatch(candidate, optimistic);

  const candidateMs = typeof candidate.timestamp === 'number' ? toMs(candidate.timestamp) : NaN;
  const optimisticMs = typeof optimistic.timestamp === 'number' ? toMs(optimistic.timestamp) : userMessageAt;
  const hasCandidateTime = Number.isFinite(candidateMs);
  const referenceMs = Number.isFinite(optimisticMs) ? optimisticMs : userMessageAt;

  if (hasCandidateTime && Number.isFinite(referenceMs)) {
    if (Math.abs(candidateMs - referenceMs) < 5000) return true;
    // During an active send, identical text is the optimistic/server pair even when
    // Gateway timestamps are missing or skewed.
    if (textMatches && userMessageAt > 0) return true;
    // A reliable timestamp far from the active send should not be treated as
    // the same turn just because the user asked the same short question again.
    if (Math.abs(candidateMs - referenceMs) > 60_000) return false;
  }

  return textMatches;
}

export function insertOptimisticUserMessage(messages: RawMessage[], optimistic: RawMessage): RawMessage[] {
  const optimisticMs = typeof optimistic.timestamp === 'number' ? toMs(optimistic.timestamp) : NaN;
  if (!Number.isFinite(optimisticMs)) return [...messages, optimistic];

  const insertAt = messages.findIndex((message) => {
    if (typeof message.timestamp !== 'number') return false;
    return toMs(message.timestamp) > optimisticMs;
  });

  if (insertAt === -1) return [...messages, optimistic];
  return [
    ...messages.slice(0, insertAt),
    optimistic,
    ...messages.slice(insertAt),
  ];
}

/** Drop later copies of the same user turn (optimistic + server, or double insert). */
export function dedupeRedundantUserMessages(
  messages: RawMessage[],
  userMessageAt: number | null,
): RawMessage[] {
  if (messages.length < 2) return messages;

  const refAt = userMessageAt ?? 0;
  const drop = new Set<number>();

  for (let i = 0; i < messages.length; i += 1) {
    if (drop.has(i)) continue;
    const first = messages[i];
    if (first.role !== 'user') continue;

    for (let j = i + 1; j < messages.length; j += 1) {
      if (drop.has(j)) continue;
      const second = messages[j];
      if (second.role !== 'user') continue;

      // True duplicate (same id) — drop regardless of position.
      if (first.id && second.id && first.id === second.id) {
        drop.add(j);
        continue;
      }

      // Only ADJACENT user messages can be the same turn (an optimistic user
      // message and its server echo, or a double insert). They sit next to each
      // other with no other message between them. Two user messages separated by
      // an assistant reply (or anything else) are distinct turns and must be kept
      // — even when their text is identical. Collapsing them by text alone was
      // the "identical input overwrites the previous output" bug: the second
      // user message was dropped, the two assistant replies merged into one turn,
      // and only the latest reply rendered.
      if (j !== i + 1) continue;

      // Adjacent pair: drop if recognized as the same turn by content/time.
      if (isSameUserMessage(second, first, refAt) || isSameUserMessage(first, second, refAt)) {
        drop.add(j);
        continue;
      }
      // Adjacent identical-text fallback (covers cases isSameUserMessage misses).
      const firstText = normalizeUserMessageText(first.content);
      const secondText = normalizeUserMessageText(second.content);
      if (firstText && firstText === secondText && attachmentsMatch(first, second)) {
        drop.add(j);
      }
    }
  }

  if (drop.size === 0) return messages;
  return messages.filter((_, index) => !drop.has(index));
}

export function mergeOptimisticUserIntoHistory(
  enrichedMessages: RawMessage[],
  currentMessages: RawMessage[],
  options: {
    userMessageAt: number | null;
    sending: boolean;
  },
): RawMessage[] {
  const { userMessageAt, sending } = options;
  if (!userMessageAt) return enrichedMessages;

  const optimistic = [...currentMessages].reverse().find(
    (m) => m.role === 'user' && m.timestamp && Math.abs(toMs(m.timestamp) - userMessageAt) < 5000,
  );
  const hasRecentUser = optimistic
    ? enrichedMessages.some((message) => isSameUserMessage(message, optimistic, userMessageAt))
    : false;
  const shouldPreserveOptimistic = !!optimistic && (sending || optimistic.isError);

  if (!hasRecentUser && shouldPreserveOptimistic && optimistic) {
    return insertOptimisticUserMessage(enrichedMessages, optimistic);
  }

  return enrichedMessages;
}
