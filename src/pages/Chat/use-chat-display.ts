import { useEffect, useMemo, useState } from 'react';
import type { RawMessage } from '@/stores/chat';
import {
  buildTurnStableKey,
  buildChatDisplayItems,
  findLastUserMessage,
  isAssistantRole,
  type ChatDisplayItem,
  mergeWorkflowCardsIntoDisplayItems,
} from './chat-display';
import type { ChatWorkflowCardRef } from '@/types/workflow';
import type { ActiveTurnStream } from './AssistantTurnMessage';
import { extractImages, extractThinking, extractToolUse } from './message-utils';

type StreamingTool = ActiveTurnStream['streamingTools'][number];

/** No chat delta for this long while still sending → show "still executing" hint. */
const STALE_EXECUTION_SILENCE_MS = 45_000;
const STALE_EXECUTION_TICK_MS = 5_000;

function hasStreamPayload(
  streamMsg: { content?: unknown } | null,
  streamText: string,
  streamingMessages: RawMessage[],
  streamingToolResults: RawMessage[],
  streamingTools: StreamingTool[],
  showThinking: boolean,
): boolean {
  const hasStreamText = streamText.trim().length > 0;
  const streamThinking = streamMsg ? extractThinking(streamMsg) : null;
  const hasStreamThinking = showThinking && !!streamThinking && streamThinking.trim().length > 0;
  const hasStreamTools = streamMsg ? extractToolUse(streamMsg).length > 0 : false;
  const hasStreamImages = streamMsg ? extractImages(streamMsg).length > 0 : false;
  const hasStreamToolStatus = streamingTools.length > 0;
  return hasStreamText
    || hasStreamThinking
    || hasStreamTools
    || hasStreamImages
    || hasStreamToolStatus
    || streamingMessages.length > 0
    || streamingToolResults.length > 0;
}

/** 仍在增量输出的流式内容（不含仅 completed 的 streamingTools） */
function hasActiveStreamContent(
  streamMsg: { content?: unknown } | null,
  streamText: string,
  streamingMessages: RawMessage[],
  streamingTools: StreamingTool[],
  showThinking: boolean,
): boolean {
  const hasStreamText = streamText.trim().length > 0;
  const streamThinking = streamMsg ? extractThinking(streamMsg) : null;
  const hasStreamThinking = showThinking && !!streamThinking && streamThinking.trim().length > 0;
  const hasStreamTools = streamMsg ? extractToolUse(streamMsg).length > 0 : false;
  const hasStreamImages = streamMsg ? extractImages(streamMsg).length > 0 : false;
  const hasRunningStreamTool = streamingTools.some((tool) => tool.status === 'running');
  return hasStreamText
    || hasStreamThinking
    || hasStreamTools
    || hasStreamImages
    || hasRunningStreamTool
    || streamingMessages.length > 0;
}

export function useChatDisplay(params: {
  messages: RawMessage[];
  sending: boolean;
  pendingFinal: boolean;
  showThinking: boolean;
  lastChatEventAt: number;
  streamMsg: { role?: string; content?: unknown; timestamp?: number; id?: string } | null;
  streamText: string;
  streamingMessages: RawMessage[];
  streamingToolResults: RawMessage[];
  streamingTools: StreamingTool[];
  lastUserMessageAt: number | null;
  workflowCards?: ChatWorkflowCardRef[];
}) {
  const {
    messages,
    sending,
    pendingFinal,
    showThinking,
    lastChatEventAt,
    streamMsg,
    streamText,
    streamingMessages = [],
    streamingToolResults = [],
    streamingTools = [],
    workflowCards = [],
    lastUserMessageAt,
  } = params;

  const [, staleTick] = useState(0);
  useEffect(() => {
    if (!sending) return;
    const id = setInterval(() => staleTick((n) => n + 1), STALE_EXECUTION_TICK_MS);
    return () => clearInterval(id);
  }, [sending]);

  const displayItems = useMemo(() => buildChatDisplayItems(messages), [messages]);

  const hasAnyStreamContent = hasStreamPayload(
    streamMsg,
    streamText,
    streamingMessages,
    streamingToolResults,
    streamingTools,
    showThinking,
  );
  const hasLiveStreamContent = hasActiveStreamContent(
    streamMsg,
    streamText,
    streamingMessages,
    streamingTools,
    showThinking,
  );
  const shouldRenderStreaming = sending && hasAnyStreamContent;

  const isStillExecuting = useMemo(() => {
    if (!sending || pendingFinal) return false;
    if (hasAnyStreamContent) return false;
    if (lastChatEventAt <= 0) return false;
    return Date.now() - lastChatEventAt > STALE_EXECUTION_SILENCE_MS;
  }, [sending, pendingFinal, hasAnyStreamContent, lastChatEventAt, staleTick]);

  const { staticItems, activeTurn } = useMemo(() => {
    if (!sending) {
      return { staticItems: displayItems, activeTurn: null as null | {
        turnStableKey: string;
        turnMessages: RawMessage[];
        turnToolResults: RawMessage[];
        precedingUserMessage: RawMessage | null;
        activeStream: ActiveTurnStream;
      } };
    }

    const streamMessage = streamMsg
      ? ({
          ...(streamMsg as Record<string, unknown>),
          role: (typeof streamMsg.role === 'string' ? streamMsg.role : 'assistant') as RawMessage['role'],
          content: streamMsg.content ?? streamText,
          timestamp: streamMsg.timestamp,
          id: streamMsg.id,
        } as RawMessage)
      : streamText.trim()
        ? ({ role: 'assistant', content: streamText } as RawMessage)
        : null;

    const activeStream: ActiveTurnStream = {
      streamMessage,
      streamText,
      streamingTools,
      streamingMessages,
      streamingToolResults,
      isConnecting: !pendingFinal && !hasAnyStreamContent && !isStillExecuting,
      isProcessing: pendingFinal && sending && !hasLiveStreamContent,
      isStillExecuting,
    };

    // Only promote the last assistant turn/message into activeTurn when the
    // current send was triggered by a user message (lastUserMessageAt is set).
    // For cron/background triggers (lastUserMessageAt === null), creating a
    // fresh activeTurn ensures the loading indicator appears as a new line
    // rather than overlaying the previous completed answer.
    const last = displayItems[displayItems.length - 1];
    if (
      lastUserMessageAt != null
      && last?.type === 'single'
      && last.message.role === 'user'
    ) {
      const userMessageIndex = messages.lastIndexOf(last.message);
      return {
        staticItems: displayItems,
        activeTurn: {
          turnStableKey: buildTurnStableKey(
            last.message,
            userMessageIndex >= 0 ? userMessageIndex : messages.length - 1,
          ),
          turnMessages: [],
          turnToolResults: [],
          precedingUserMessage: last.message,
          activeStream,
        },
      };
    }

    if (lastUserMessageAt != null && last?.type === 'assistant-turn') {
      return {
        staticItems: displayItems.slice(0, -1),
        activeTurn: {
          turnStableKey: last.key,
          turnMessages: last.messages,
          turnToolResults: last.toolResults,
          precedingUserMessage: last.precedingUserMessage ?? findLastUserMessage(messages),
          activeStream,
        },
      };
    }

    if (lastUserMessageAt != null && last?.type === 'single' && isAssistantRole(last.message.role)) {
      return {
        staticItems: displayItems.slice(0, -1),
        activeTurn: {
          turnStableKey: last.key,
          turnMessages: [last.message],
          turnToolResults: [],
          precedingUserMessage: findLastUserMessage(messages),
          activeStream,
        },
      };
    }

    // Fresh background/cron trigger (lastUserMessageAt === null): the activeTurn
    // represents a brand-new run that must NOT anchor to the previous user
    // message. Passing `precedingUserMessage: null` keeps
    // collectActiveTurnStreamSources from scanning session history, so the
    // connecting indicator renders as a new line instead of overlaying the
    // previous completed answer. `turnStableKey: 'active-turn'` avoids reusing
    // the previous turn's tool/timeline cache (migrated to the real key on
    // completion via migrateTurnDisplayCache).
    return {
      staticItems: displayItems,
      activeTurn: {
        turnStableKey: 'active-turn',
        turnMessages: [],
        turnToolResults: [],
        precedingUserMessage: null,
        activeStream,
      },
    };
  }, [
    displayItems,
    sending,
    pendingFinal,
    showThinking,
    streamMsg,
    streamText,
    streamingMessages,
    streamingToolResults,
    streamingTools,
    isStillExecuting,
    lastUserMessageAt,
  ]);

  const visibleWorkflowCards = activeTurn?.precedingUserMessage?.id
    ? workflowCards.filter((card) => card.anchorUserMessageId !== activeTurn.precedingUserMessage?.id)
    : workflowCards;
  const staticItemsWithWorkflowCards = mergeWorkflowCardsIntoDisplayItems(
    staticItems,
    visibleWorkflowCards,
  );

  return {
    staticItems: staticItemsWithWorkflowCards,
    activeTurn,
    shouldRenderStreaming,
    hasAnyStreamContent,
  };
}

export type { ChatDisplayItem };
