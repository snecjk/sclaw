import { useMemo } from 'react';
import type { RawMessage } from '@/stores/chat';
import { buildChatDisplayItems, type ChatDisplayItem } from './chat-display';
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
}) {
  const { messages, sending, pendingFinal, showThinking, streamMsg, streamText, streamingTools } = params;

  const displayItems = useMemo(() => buildChatDisplayItems(messages), [messages]);

  const hasAnyStreamContent = hasStreamPayload(streamMsg, streamText, streamingTools, showThinking);
  const shouldRenderStreaming = sending && hasAnyStreamContent;

  const { staticItems, activeTurn } = useMemo(() => {
    if (!sending) {
      return { staticItems: displayItems, activeTurn: null as null | {
        turnMessages: RawMessage[];
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

    const last = displayItems[displayItems.length - 1];
    if (last?.type === 'assistant-turn') {
      return {
        staticItems: displayItems.slice(0, -1),
        activeTurn: { turnMessages: last.messages, activeStream },
      };
    }

    return {
      staticItems: displayItems,
      activeTurn: { turnMessages: [], activeStream },
    };
  }, [
    displayItems,
    sending,
    streamMsg,
    streamText,
    streamingTools,
    pendingFinal,
    hasAnyStreamContent,
    shouldRenderStreaming,
  ]);

  return { staticItems, activeTurn, shouldRenderStreaming, hasAnyStreamContent };
}

export type { ChatDisplayItem };
