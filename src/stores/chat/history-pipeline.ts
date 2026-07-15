import {
  enrichWithCachedImages,
  enrichWithToolResultFiles,
  isToolResultRole,
} from './helpers';
import { mergeLocalWorkflowTurnsFromCurrent, mergeWorkflowTurnsFromMemory } from '@/lib/workflow-local-turn';
import { ensureWorkflowCardsInMessages, mergeWorkflowCardBlocksFromCurrent } from '@/lib/workflow-card-injection';
import {
  dedupeRedundantUserMessages,
  ensureOpeningUserMessageFirst,
  recoverInitialUserFromSessionLabel,
} from './user-message-merge';
import {
  absorbWorkflowSchemaFromToolResults,
  mergeParameterFormBlocksFromCurrent,
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
  currentMessages: RawMessage[];
  sessionKey: string;
}): PreparedHistoryMessages {
  const rawMessages = mergeHistoryWhenShrunk(input.rawMessages, input.currentMessages);
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
  getMessageText: (content: unknown) => string;
}): RawMessage[] {
  const {
    currentMessages,
    gatewaySessionLabel,
    getMessageText,
    sessionKey,
    sessionLabels,
    sending,
    userMessageAt,
  } = input;

  let messages = mergeParameterFormBlocksFromCurrent(
    input.messages,
    currentMessages,
    getMessageText,
  );
  messages = mergeLocalWorkflowTurnsFromCurrent(messages, currentMessages);
  messages = mergeWorkflowCardBlocksFromCurrent(messages, currentMessages);
  messages = mergeWorkflowTurnsFromMemory(messages, sessionKey);
  messages = ensureWorkflowCardsInMessages(messages, sessionKey, getMessageText);
  messages = recoverInitialUserFromSessionLabel(
    messages,
    sessionKey,
    sessionLabels,
    gatewaySessionLabel,
    { sending },
  );
  messages = ensureOpeningUserMessageFirst(
    messages,
    sessionKey,
    sessionLabels,
    gatewaySessionLabel,
    { sending },
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
