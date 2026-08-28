import {
  enrichWithCachedImages,
  enrichWithToolResultFiles,
  isToolResultRole,
} from './helpers';
import {
  dedupeRedundantUserMessages,
  ensureOpeningUserMessageFirst,
  mergeOptimisticUserIntoHistory,
  reapplyComposerUiFromPreviousDisplay,
  recoverInitialUserFromSessionLabel,
} from './user-message-merge';
import {
  absorbWorkflowSchemaFromToolResults,
} from './parameter-form-recovery';
import { mergeHistoryWhenShrunk } from './history-merge';
import type { RawMessage } from './types';

export interface PreparedHistoryMessages {
  rawMessages: RawMessage[];
  filteredMessages: RawMessage[];
  enrichedMessages: RawMessage[];
}

export function prepareHistoryMessages(input: {
  rawMessages: RawMessage[];
  previousTranscript?: RawMessage[];
  /** @deprecated Compatibility for callers predating canonical transcript storage. */
  currentMessages?: RawMessage[];
  sessionKey: string;
}): PreparedHistoryMessages {
  const rawMessages = mergeHistoryWhenShrunk(
    input.rawMessages,
    input.previousTranscript ?? input.currentMessages ?? [],
  );
  absorbWorkflowSchemaFromToolResults(rawMessages, input.sessionKey);

  const messagesWithToolImages = enrichWithToolResultFiles(rawMessages);
  const filteredMessages = messagesWithToolImages.filter((msg) => !isToolResultRole(msg.role));
  const enrichedMessages = enrichWithCachedImages(filteredMessages);

  return {
    rawMessages,
    filteredMessages,
    enrichedMessages,
  };
}

export function mergeHistoryDisplayMessages(input: {
  messages: RawMessage[];
  currentMessages: RawMessage[];
  sessionKey: string;
  sessionLabels: Record<string, string>;
  gatewaySessionLabel?: string;
  userMessageAt: number | null;
  sending: boolean;
  optimisticUser?: RawMessage | null;
  getMessageText: (content: unknown) => string;
  /** Overlay 乐观用户消息——把 segments/展示写到 history 回显上。 */
  cachedOptimistic?: RawMessage | null;
}): RawMessage[] {
  const {
    gatewaySessionLabel,
    sessionKey,
    sessionLabels,
    sending,
    optimisticUser,
    userMessageAt,
    cachedOptimistic,
  } = input;
  const recoveryOptions = { sending, optimisticUser };

  let messages = input.messages;
  messages = mergeOptimisticUserIntoHistory(messages, input.currentMessages, {
    userMessageAt,
    sending,
    sessionKey,
    cachedOptimistic,
  });
  // 中途 history 重载会清掉 overlay 乐观消息；从上一帧投影保留 segments。
  messages = reapplyComposerUiFromPreviousDisplay(
    messages,
    input.currentMessages,
    userMessageAt,
  );
  messages = recoverInitialUserFromSessionLabel(
    messages,
    sessionKey,
    sessionLabels,
    gatewaySessionLabel,
    recoveryOptions,
  );
  messages = ensureOpeningUserMessageFirst(
    messages,
    sessionKey,
    sessionLabels,
    gatewaySessionLabel,
    recoveryOptions,
  );

  return dedupeRedundantUserMessages(messages, userMessageAt, { sessionKey });
}

export function analyzeRecentAssistantActivity(input: {
  filteredMessages: RawMessage[];
  currentMessages: RawMessage[];
  userMessageAt: number | null;
  sending: boolean;
  toMs: (ts: unknown) => number;
  hasAssistantTextOutput: (message: RawMessage) => boolean;
}): {
  hasRecentAssistantActivity: boolean;
  hasRecentAssistantOutput: boolean;
} {
  const {
    currentMessages,
    filteredMessages,
    hasAssistantTextOutput,
    sending,
    toMs,
    userMessageAt,
  } = input;
  const userMsTs = userMessageAt ? toMs(userMessageAt) : 0;
  const isAfterUserMsg = (msg: RawMessage): boolean => {
    if (!userMsTs || !msg.timestamp) return true;
    return toMs(msg.timestamp) >= userMsTs;
  };

  const hasRecentAssistantActivity = sending && [...filteredMessages].reverse().some((msg) => {
    if (msg.role !== 'assistant') return false;
    return isAfterUserMsg(msg);
  });
  const recentAssistant = [...filteredMessages].reverse().find((msg) => {
    if (msg.role !== 'assistant') return false;
    if (!hasAssistantTextOutput(msg)) return false;
    return isAfterUserMsg(msg);
  });
  const currentRecentAssistant = [...currentMessages].reverse().find((msg) => {
    if (msg.role !== 'assistant') return false;
    if (!hasAssistantTextOutput(msg)) return false;
    return isAfterUserMsg(msg);
  });

  return {
    hasRecentAssistantActivity,
    hasRecentAssistantOutput: Boolean(recentAssistant || currentRecentAssistant),
  };
}
