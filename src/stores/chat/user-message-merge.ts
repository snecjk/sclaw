import { stripCronLabelPrefix } from '@/lib/cron-session-display';
import { normalizeUserMessageForDisplay } from '@/lib/user-message-display';
import { resolveStoredSessionLabel } from '@/lib/session-label';
import {
  isCorruptedSessionLabel,
  isPlaceholderSessionLabel,
} from '@/lib/workflow-session-hint';
import {
  formatChatSessionTraceLine,
  traceChatSession,
  truncateChatSessionText,
} from '../../../shared/chat-session-trace';
import { getMessageText, toMs } from './helpers';
import type { RawMessage } from './types';

const OPTIMISTIC_SEND_WINDOW_MS = 5_000;
/** Broad window for matching a late Gateway user echo to the current send. */
const SERVER_ECHO_WINDOW_MS = 120_000;

export function normalizeUserMessageText(content: unknown): string {
  return getMessageText(content)
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeUserMessageForPairing(content: unknown): string {
  return normalizeUserMessageForDisplay(getMessageText(content));
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

function displayTextMatches(a: RawMessage, b: RawMessage): boolean {
  const aText = normalizeUserMessageForPairing(a.content);
  const bText = normalizeUserMessageForPairing(b.content);
  return aText.length > 0 && aText === bText && attachmentsMatch(a, b);
}

function hasSkillUserMeta(message: RawMessage): boolean {
  return message.role === 'user' && Boolean(message._skillMeta);
}

/** User bubble is visible when there is display text and/or a skill tag. */
export function hasVisibleUserMessageContent(message: RawMessage): boolean {
  if (message.role !== 'user') return false;
  if (hasSkillUserMeta(message)) return true;
  return normalizeUserMessageForDisplay(getMessageText(message.content)).length > 0;
}

function patchSkillUserMessageFromOptimistic(
  serverMessage: RawMessage,
  optimistic: RawMessage,
): RawMessage {
  return {
    ...serverMessage,
    _skillMeta: optimistic._skillMeta ?? serverMessage._skillMeta,
    // Keep UI display text only — never surface Gateway defaultPrompt in the bubble.
    content: optimistic.content ?? '',
  };
}

function applyOptimisticSkillDisplay(
  enrichedMessages: RawMessage[],
  optimistic: RawMessage | undefined,
  historyEcho: RawMessage,
  refAt: number,
): RawMessage[] {
  if (!optimistic?._skillMeta) return enrichedMessages;
  return enrichedMessages.map((message) => {
    if (message.role !== 'user') return message;
    if (message.id && historyEcho.id && message.id === historyEcho.id) {
      return patchSkillUserMessageFromOptimistic(message, optimistic);
    }
    if (isSameUserMessage(message, optimistic, refAt)) {
      return patchSkillUserMessageFromOptimistic(message, optimistic);
    }
    return message;
  });
}

function isNearUserSend(message: RawMessage, userMessageAt: number): boolean {
  if (message.role !== 'user' || !userMessageAt) return false;
  const ts = typeof message.timestamp === 'number' ? toMs(message.timestamp) : NaN;
  return Number.isFinite(ts) && Math.abs(ts - userMessageAt) < OPTIMISTIC_SEND_WINDOW_MS;
}

function isLikelyOptimisticEcho(message: RawMessage, userMessageAt: number): boolean {
  return isNearUserSend(message, userMessageAt);
}

export function isSameUserMessage(
  candidate: RawMessage,
  optimistic: RawMessage,
  userMessageAt: number,
): boolean {
  if (candidate.role !== 'user') return false;
  if (candidate.id && optimistic.id && candidate.id === optimistic.id) return true;

  const displayMatches = displayTextMatches(candidate, optimistic);
  const candidateText = normalizeUserMessageText(candidate.content);
  const optimisticText = normalizeUserMessageText(optimistic.content);
  const rawTextMatches = candidateText.length > 0
    && candidateText === optimisticText
    && attachmentsMatch(candidate, optimistic);

  const candidateMs = typeof candidate.timestamp === 'number' ? toMs(candidate.timestamp) : NaN;
  const optimisticMs = typeof optimistic.timestamp === 'number' ? toMs(optimistic.timestamp) : userMessageAt;
  const hasCandidateTime = Number.isFinite(candidateMs);
  const referenceMs = Number.isFinite(optimisticMs) ? optimisticMs : userMessageAt;

  if (optimistic._skillMeta) {
    if (candidate.id && optimistic.id && candidate.id === optimistic.id) return true;
    if (hasCandidateTime && Number.isFinite(referenceMs)) {
      if (Math.abs(candidateMs - referenceMs) < OPTIMISTIC_SEND_WINDOW_MS) return true;
    }
    if (userMessageAt > 0 && hasCandidateTime && Math.abs(candidateMs - userMessageAt) < SERVER_ECHO_WINDOW_MS) {
      return true;
    }
  }

  if (hasCandidateTime && Number.isFinite(referenceMs)) {
    if (Math.abs(candidateMs - referenceMs) < OPTIMISTIC_SEND_WINDOW_MS) {
      return displayMatches || rawTextMatches;
    }
    // During an active send, identical display text is the optimistic/server pair even when
    // Gateway timestamps are missing or skewed.
    if (displayMatches && userMessageAt > 0) return true;
    if (rawTextMatches && userMessageAt > 0) return true;
    if (Math.abs(candidateMs - referenceMs) > 60_000) return false;
  }

  return displayMatches || rawTextMatches;
}

function findHistoryUserEcho(
  enrichedMessages: RawMessage[],
  optimistic: RawMessage,
  userMessageAt: number,
): RawMessage | undefined {
  return enrichedMessages.find((message) => {
    if (message.role !== 'user') return false;
    if (isSameUserMessage(message, optimistic, userMessageAt)) return true;
    if (!displayTextMatches(message, optimistic)) return false;
    const ts = typeof message.timestamp === 'number' ? toMs(message.timestamp) : NaN;
    if (!Number.isFinite(ts)) return userMessageAt > 0;
    return Math.abs(ts - userMessageAt) <= SERVER_ECHO_WINDOW_MS;
  });
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

function summarizeUserMessage(message: RawMessage): Record<string, unknown> {
  return {
    id: message.id,
    ts: message.timestamp,
    rawLen: normalizeUserMessageText(message.content).length,
    display: truncateChatSessionText(normalizeUserMessageForPairing(message.content)),
  };
}

function isRedundantSkillUserDuplicate(first: RawMessage, second: RawMessage): boolean {
  if (first.role !== 'user' || second.role !== 'user') return false;
  if (first.id?.startsWith('session-label-user-') || second.id?.startsWith('session-label-user-')) {
    return false;
  }

  if (!first._skillMeta || !second._skillMeta) return false;
  if (first._skillMeta.slug !== second._skillMeta.slug) return false;

  const firstDisplay = normalizeUserMessageForPairing(first.content);
  const secondDisplay = normalizeUserMessageForPairing(second.content);
  if (firstDisplay && firstDisplay === secondDisplay) return true;

  const title = first._skillMeta.title.trim();
  if (!firstDisplay && secondDisplay === title) return true;
  if (!secondDisplay && firstDisplay === title) return true;
  return false;
}

/** Drop later copies of the same user turn (optimistic + server, or double insert). */
export function dedupeRedundantUserMessages(
  messages: RawMessage[],
  userMessageAt: number | null,
  traceContext?: { sessionKey?: string },
): RawMessage[] {
  if (messages.length < 2) return messages;

  const refAt = userMessageAt ?? 0;
  const drop = new Set<number>();
  const droppedIds: string[] = [];
  const patches = new Map<number, RawMessage>();

  const patchKeptUser = (keptIndex: number, droppedMessage: RawMessage) => {
    if (!droppedMessage._skillMeta) return;
    const kept = patches.get(keptIndex) ?? messages[keptIndex];
    if (!kept || kept.role !== 'user') return;
    patches.set(keptIndex, patchSkillUserMessageFromOptimistic(kept, droppedMessage));
  };

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
        if (second.id) droppedIds.push(second.id);
        continue;
      }

      const sameTurnByDisplay = displayTextMatches(first, second);

      // Synthetic opener from session label vs real history user (may be non-adjacent).
      const firstSynthetic = typeof first.id === 'string' && first.id.startsWith('session-label-user-');
      const secondSynthetic = typeof second.id === 'string' && second.id.startsWith('session-label-user-');
      if (sameTurnByDisplay && (firstSynthetic || secondSynthetic)) {
        if (firstSynthetic && !secondSynthetic) {
          drop.add(i);
          if (first.id) droppedIds.push(first.id);
          break;
        }
        if (secondSynthetic) {
          drop.add(j);
          if (second.id) droppedIds.push(second.id);
          continue;
        }
      }

      // Only ADJACENT user messages can be the same turn (an optimistic user
      // message and its server echo, or a double insert). Two user messages separated by
      // an assistant reply (or anything else) are distinct turns and must be kept
      // — even when their text is identical. Collapsing them by text alone was
      // the "identical input overwrites the previous output" bug: the second
      // user message was dropped, the two assistant replies merged into one turn,
      // and only the latest reply rendered.
      if (j === i + 1) {
        if (first.id?.startsWith('session-label-user-') && second._skillMeta) {
          drop.add(i);
          if (first.id) droppedIds.push(first.id);
          break;
        }
        if (second.id?.startsWith('session-label-user-') && first._skillMeta) {
          patchKeptUser(i, second);
          drop.add(j);
          if (second.id) droppedIds.push(second.id);
          continue;
        }
        if (isSameUserMessage(second, first, refAt) || isSameUserMessage(first, second, refAt)) {
          patchKeptUser(i, second);
          drop.add(j);
          if (second.id) droppedIds.push(second.id);
          continue;
        }
        if (isRedundantSkillUserDuplicate(first, second)) {
          patchKeptUser(i, second);
          drop.add(j);
          if (second.id) droppedIds.push(second.id);
          continue;
        }
        const firstText = normalizeUserMessageText(first.content);
        const secondText = normalizeUserMessageText(second.content);
        if (firstText && firstText === secondText && attachmentsMatch(first, second)) {
          patchKeptUser(i, second);
          drop.add(j);
          if (second.id) droppedIds.push(second.id);
        }
        continue;
      }

      // During an active send, drop a non-adjacent optimistic echo when Gateway
      // history already contains the same visible user turn (often separated by
      // assistant/tool messages that arrived via streaming before loadHistory).
      if (refAt > 0 && sameTurnByDisplay) {
        const firstOptimistic = isLikelyOptimisticEcho(first, refAt);
        const secondOptimistic = isLikelyOptimisticEcho(second, refAt);
        // Only drop the in-flight optimistic copy; never drop a later real user
        // turn that happens to reuse the same visible text.
        if (firstOptimistic && !secondOptimistic) {
          patchKeptUser(j, first);
          drop.add(i);
          if (first.id) droppedIds.push(first.id);
          break;
        }
      }
    }
  }

  if (drop.size === 0) return messages;

  traceChatSession({
    phase: 'dedupe-user',
    action: 'drop-duplicate-user',
    sessionKey: traceContext?.sessionKey,
    userMessageAt,
    messageCountBefore: messages.length,
    messageCountAfter: messages.length - drop.size,
    droppedMessageIds: droppedIds,
    reason: refAt > 0 ? 'active-send-echo' : 'same-id-or-adjacent',
    detail: {
      droppedIndexes: [...drop],
      keptUsers: messages
        .filter((_, index) => !drop.has(index) && messages[index]?.role === 'user')
        .map(summarizeUserMessage),
    },
  });

  return messages
    .map((message, index) => patches.get(index) ?? message)
    .filter((_, index) => !drop.has(index));
}

function historyHasVisibleUserMessage(messages: RawMessage[]): boolean {
  return messages.some((message) => hasVisibleUserMessageContent(message));
}

function findRecoverableUserMessage(
  enrichedMessages: RawMessage[],
  currentMessages: RawMessage[],
  userMessageAt: number | null,
  cachedOptimistic?: RawMessage | null,
): RawMessage | undefined {
  if (userMessageAt) {
    const fromCurrent = [...currentMessages].reverse().find(
      (message) => message.role === 'user'
        && message.timestamp
        && Math.abs(toMs(message.timestamp) - userMessageAt) < OPTIMISTIC_SEND_WINDOW_MS,
    );
    if (fromCurrent) return fromCurrent;
    if (
      cachedOptimistic
      && cachedOptimistic.role === 'user'
      && cachedOptimistic.timestamp
      && Math.abs(toMs(cachedOptimistic.timestamp) - userMessageAt) < OPTIMISTIC_SEND_WINDOW_MS
    ) {
      return cachedOptimistic;
    }
  }

  const candidates = [
    ...(cachedOptimistic?.role === 'user' ? [cachedOptimistic] : []),
    ...currentMessages.filter((message) => message.role === 'user'),
  ];
  for (const candidate of candidates) {
    const display = normalizeUserMessageForDisplay(getMessageText(candidate.content));
    if (!display && !candidate._skillMeta) continue;
    const refAt = userMessageAt ?? (candidate.timestamp ? toMs(candidate.timestamp) : 0);
    if (findHistoryUserEcho(enrichedMessages, candidate, refAt)) continue;
    if (enrichedMessages.some((message) => message.role === 'user' && displayTextMatches(message, candidate))) {
      continue;
    }
    return candidate;
  }
  return undefined;
}

function earliestMessageTimestampMs(messages: RawMessage[]): number | undefined {
  let min: number | undefined;
  for (const message of messages) {
    if (typeof message.timestamp !== 'number') continue;
    const ms = toMs(message.timestamp);
    if (ms <= 0) continue;
    min = min === undefined ? ms : Math.min(min, ms);
  }
  return min;
}

function openingUserTimestampSeconds(messages: RawMessage[]): number {
  const earliestMs = earliestMessageTimestampMs(messages);
  return earliestMs !== undefined ? (earliestMs - 1) / 1000 : Date.now() / 1000;
}

function resolveOpeningSessionLabel(
  sessionKey: string,
  sessionLabels: Record<string, string>,
  gatewayLabel?: string,
): string | undefined {
  const stored = resolveStoredSessionLabel(sessionKey, sessionLabels)?.trim();
  if (stored && !isCorruptedSessionLabel(stored) && !isPlaceholderSessionLabel(stored)) {
    return stripCronLabelPrefix(stored) || stored;
  }
  const label = gatewayLabel?.trim();
  if (label && !isCorruptedSessionLabel(label) && !isPlaceholderSessionLabel(label)) {
    return stripCronLabelPrefix(label) || label;
  }
  return undefined;
}

function historyHasOpeningUserTurn(messages: RawMessage[], openingLabel: string | undefined): boolean {
  if (!openingLabel) return false;
  return messages.some((message) => {
    if (message.role !== 'user') return false;
    const display = normalizeUserMessageForDisplay(getMessageText(message.content));
    if (message._skillMeta) {
      if (!display) return message._skillMeta.title === openingLabel;
      return display === openingLabel || message._skillMeta.title === openingLabel;
    }
    return display === openingLabel;
  });
}

function historyHasSkillUserTurn(messages: RawMessage[]): boolean {
  return messages.some((message) => message.role === 'user' && Boolean(message._skillMeta));
}

/** Drop synthetic session-label user rows when a real skill-tagged user turn already exists. */
export function dropSyntheticSkillSessionLabelUsers(messages: RawMessage[]): RawMessage[] {
  if (!historyHasSkillUserTurn(messages)) return messages;
  return messages.filter((message) => {
    if (message.role !== 'user') return true;
    return !message.id?.startsWith('session-label-user-');
  });
}

/** Reconstruct the opening user turn from a stored session title when history omits it. */
export function recoverInitialUserFromSessionLabel(
  enrichedMessages: RawMessage[],
  sessionKey: string,
  sessionLabels: Record<string, string>,
  gatewayLabel?: string,
  options?: { sending?: boolean },
): RawMessage[] {
  // Mid-send: optimistic user already covers the opener; label recovery doubles it.
  if (options?.sending) return enrichedMessages;
  if (historyHasSkillUserTurn(enrichedMessages)) return enrichedMessages;
  const label = resolveOpeningSessionLabel(sessionKey, sessionLabels, gatewayLabel);
  if (!label || historyHasOpeningUserTurn(enrichedMessages, label)) return enrichedMessages;
  return insertOptimisticUserMessage(enrichedMessages, {
    role: 'user',
    content: label,
    timestamp: openingUserTimestampSeconds(enrichedMessages),
    id: `session-label-user-${sessionKey}`,
  } as RawMessage);
}

/** Keep the session-opening user turn before assistant/workflow messages after history merges. */
export function ensureOpeningUserMessageFirst(
  messages: RawMessage[],
  sessionKey: string,
  sessionLabels: Record<string, string>,
  gatewayLabel?: string,
  options?: { sending?: boolean },
): RawMessage[] {
  // Mid-send: do not rewrite timestamps / inject openers while stream+history race.
  if (options?.sending) return messages;
  const label = resolveOpeningSessionLabel(sessionKey, sessionLabels, gatewayLabel);
  let working = messages;
  if (label && !historyHasOpeningUserTurn(working, label)) {
    working = recoverInitialUserFromSessionLabel(working, sessionKey, sessionLabels, gatewayLabel, options);
  }

  const visibleUsers = working.filter((message) => hasVisibleUserMessageContent(message));
  if (visibleUsers.length === 0) return working;

  let openingUser = visibleUsers.reduce((earliest, message) => (
    toMs(message.timestamp) < toMs(earliest.timestamp) ? message : earliest
  ));
  if (label) {
    const labeled = visibleUsers.find(
      (message) => normalizeUserMessageForDisplay(getMessageText(message.content)) === label,
    );
    if (labeled) openingUser = labeled;
  }

  const sorted = [...working].sort((left, right) => toMs(left.timestamp) - toMs(right.timestamp));
  const openingIndex = sorted.findIndex((message) => (
    message.id === openingUser.id
    || (message.role === 'user' && displayTextMatches(message, openingUser))
  ));
  if (openingIndex <= 0) return sorted;

  const correctedTimestamp = openingUserTimestampSeconds(working);
  const patched = working.map((message) => {
    if (message.id !== openingUser.id && !displayTextMatches(message, openingUser)) {
      return message;
    }
    if (message.role !== 'user') return message;
    return { ...message, timestamp: correctedTimestamp };
  });
  return patched.sort((left, right) => toMs(left.timestamp) - toMs(right.timestamp));
}

function findSkillOptimisticForPatch(
  currentMessages: RawMessage[],
  cachedOptimistic?: RawMessage | null,
): RawMessage | undefined {
  const candidates = [
    ...(cachedOptimistic?.role === 'user' && cachedOptimistic._skillMeta ? [cachedOptimistic] : []),
    ...currentMessages.filter((message) => message.role === 'user' && message._skillMeta),
  ];
  return candidates[candidates.length - 1];
}

export function mergeOptimisticUserIntoHistory(
  enrichedMessages: RawMessage[],
  currentMessages: RawMessage[],
  options: {
    userMessageAt: number | null;
    sending: boolean;
    sessionKey?: string;
    /** Fallback when switchSession cleared messages[] but runtime still holds the optimistic user. */
    cachedOptimistic?: RawMessage | null;
  },
): RawMessage[] {
  const { userMessageAt, sending, sessionKey, cachedOptimistic } = options;
  if (!userMessageAt && historyHasVisibleUserMessage(enrichedMessages)) {
    const optimistic = findSkillOptimisticForPatch(currentMessages, cachedOptimistic);
    if (optimistic?._skillMeta) {
      const refAt = optimistic.timestamp ? toMs(optimistic.timestamp) : 0;
      const historyEcho = findHistoryUserEcho(enrichedMessages, optimistic, refAt);
      if (historyEcho) {
        return applyOptimisticSkillDisplay(enrichedMessages, optimistic, historyEcho, refAt);
      }
    }
    return enrichedMessages;
  }

  const optimistic = findRecoverableUserMessage(
    enrichedMessages,
    currentMessages,
    userMessageAt,
    cachedOptimistic,
  );
  const refAt = userMessageAt ?? (optimistic?.timestamp ? toMs(optimistic.timestamp) : 0);
  const historyEcho = optimistic
    ? findHistoryUserEcho(enrichedMessages, optimistic, refAt)
    : undefined;
  const hasRecentUser = Boolean(historyEcho);
  const shouldPreserveOptimistic = !!optimistic && (
    sending
    || optimistic.isError
    || !historyHasVisibleUserMessage(enrichedMessages)
  );

  if (hasRecentUser && historyEcho) {
    const merged = applyOptimisticSkillDisplay(enrichedMessages, optimistic, historyEcho, refAt);
    traceChatSession({
      phase: 'merge-optimistic',
      action: 'use-history-user',
      sessionKey,
      userMessageAt,
      sending,
      optimisticId: optimistic?.id,
      matchedHistoryUserId: historyEcho.id,
      messageCountBefore: enrichedMessages.length,
      messageCountAfter: merged.length,
      reason: optimistic?.id && historyEcho.id && optimistic.id === historyEcho.id
        ? 'id-match'
        : 'display-or-time-match',
      detail: {
        optimistic: optimistic ? summarizeUserMessage(optimistic) : undefined,
        historyUser: summarizeUserMessage(historyEcho),
      },
    });
    return merged;
  }

  if (!hasRecentUser && shouldPreserveOptimistic && optimistic) {
    traceChatSession({
      phase: 'merge-optimistic',
      action: 'insert-optimistic',
      sessionKey,
      userMessageAt,
      sending,
      optimisticId: optimistic.id,
      messageCountBefore: enrichedMessages.length,
      messageCountAfter: enrichedMessages.length + 1,
      reason: 'history-missing-user',
      detail: {
        optimistic: summarizeUserMessage(optimistic),
        historyUserCount: enrichedMessages.filter((m) => m.role === 'user').length,
      },
    });
    return insertOptimisticUserMessage(enrichedMessages, optimistic);
  }

  if (optimistic && !shouldPreserveOptimistic) {
    traceChatSession({
      phase: 'merge-optimistic',
      action: 'skip-optimistic-not-sending',
      sessionKey,
      userMessageAt,
      sending,
      optimisticId: optimistic.id,
      reason: 'send-finished',
    });
  }

  return enrichedMessages;
}

/** Log loadHistory reconciliation summary (call after merge + dedupe). */
export function traceLoadHistoryUserReconciliation(params: {
  sessionKey: string;
  userMessageAt: number | null;
  sending: boolean;
  beforeCount: number;
  afterCount: number;
  userCountBefore: number;
  userCountAfter: number;
}): void {
  if (params.userCountAfter <= params.userCountBefore && params.afterCount === params.beforeCount) {
    return;
  }
  traceChatSession({
    phase: 'load-history',
    action: 'user-reconcile',
    sessionKey: params.sessionKey,
    userMessageAt: params.userMessageAt,
    sending: params.sending,
    messageCountBefore: params.beforeCount,
    messageCountAfter: params.afterCount,
    reason: `users ${params.userCountBefore}->${params.userCountAfter}`,
  });
}

export { formatChatSessionTraceLine };
