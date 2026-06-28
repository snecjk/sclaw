import { useMemo } from 'react';
import type { RawMessage } from '@/stores/chat';
import { buildChatDisplayItems, findLastUserMessage, isAssistantRole, type ChatDisplayItem } from './chat-display';
import type { ActiveTurnStream } from './AssistantTurnMessage';
import { extractImages, extractThinking, extractToolUse } from './message-utils';

type StreamingTool = ActiveTurnStream['streamingTools'][number];

function hasStreamPayload(
  streamMsg: { content?: unknown } | null,
  streamText: string,
  streamingTools: StreamingTool[],
  showThinking: boolean,
): boolean {
  const hasStreamText = streamText.trim().length > 0;
  const streamThinking = streamMsg ? extractThinking(streamMsg) : null;
  const hasStreamThinking = showThinking && !!streamThinking && streamThinking.trim().length > 0;
  const hasStreamTools = streamMsg ? extractToolUse(streamMsg).length > 0 : false;
  const hasStreamImages = streamMsg ? extractImages(streamMsg).length > 0 : false;
  const hasStreamToolStatus = streamingTools.length > 0;
  return hasStreamText || hasStreamThinking || hasStreamTools || hasStreamImages || hasStreamToolStatus;
}

export function useChatDisplay(params: {
  messages: RawMessage[];
  sending: boolean;
  pendingFinal: boolean;
  showThinking: boolean;
  streamMsg: { role?: string; content?: unknown; timestamp?: number; id?: string } | null;
  streamText: string;
  streamingTools: StreamingTool[];
  lastUserMessageAt: number | null;
}) {
  const { messages, sending, pendingFinal, showThinking, streamMsg, streamText, streamingTools, lastUserMessageAt } = params;

  const displayItems = useMemo(() => buildChatDisplayItems(messages), [messages]);

  const hasAnyStreamContent = hasStreamPayload(streamMsg, streamText, streamingTools, showThinking);
  const shouldRenderStreaming = sending && hasAnyStreamContent;

  const { staticItems, activeTurn } = useMemo(() => {
    if (!sending) {
      return { staticItems: displayItems, activeTurn: null as null | {
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
      isConnecting: !pendingFinal && !hasAnyStreamContent,
      isProcessing: pendingFinal && !shouldRenderStreaming,
    };

    // Only promote the last assistant turn/message into activeTurn when the
    // current send was triggered by a user message (lastUserMessageAt is set).
    // For cron/background triggers (lastUserMessageAt === null), creating a
    // fresh activeTurn ensures the loading indicator appears as a new line
    // rather than overlaying the previous completed answer.
    const last = displayItems[displayItems.length - 1];
    if (lastUserMessageAt != null && last?.type === 'assistant-turn') {
      return {
        staticItems: displayItems.slice(0, -1),
        activeTurn: {
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
          turnMessages: [last.message],
          turnToolResults: [],
          precedingUserMessage: findLastUserMessage(messages),
          activeStream,
        },
      };
    }

    return {
      staticItems: displayItems,
      activeTurn: {
        turnMessages: [],
        turnToolResults: [],
        precedingUserMessage: findLastUserMessage(messages),
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
    streamingTools,
    lastUserMessageAt,
  ]);

  return { staticItems, activeTurn, shouldRenderStreaming, hasAnyStreamContent };
}

export type { ChatDisplayItem };
