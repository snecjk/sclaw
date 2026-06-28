import { useEffect, useMemo, useState } from 'react';
import type { RawMessage } from '@/stores/chat';
import { buildChatDisplayItems, findLastUserMessage, isAssistantRole, type ChatDisplayItem } from './chat-display';
import type { ActiveTurnStream } from './AssistantTurnMessage';
import { extractImages, extractThinking, extractToolUse } from './message-utils';

type StreamingTool = ActiveTurnStream['streamingTools'][number];

/** No chat delta for this long while still sending → show "still executing" hint. */
const STALE_EXECUTION_SILENCE_MS = 45_000;
const STALE_EXECUTION_TICK_MS = 5_000;

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
  lastChatEventAt: number;
  streamMsg: { role?: string; content?: unknown; timestamp?: number; id?: string } | null;
  streamText: string;
  streamingTools: StreamingTool[];
}) {
  const { messages, sending, pendingFinal, showThinking, lastChatEventAt, streamMsg, streamText, streamingTools } = params;

  const [, staleTick] = useState(0);
  useEffect(() => {
    if (!sending) return;
    const id = setInterval(() => staleTick((n) => n + 1), STALE_EXECUTION_TICK_MS);
    return () => clearInterval(id);
  }, [sending]);

  const displayItems = useMemo(() => buildChatDisplayItems(messages), [messages]);

  const hasAnyStreamContent = hasStreamPayload(streamMsg, streamText, streamingTools, showThinking);
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
      isConnecting: !pendingFinal && !hasAnyStreamContent && !isStillExecuting,
      isProcessing: pendingFinal && !shouldRenderStreaming,
      isStillExecuting,
    };

    const last = displayItems[displayItems.length - 1];
    if (last?.type === 'assistant-turn') {
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

    if (last?.type === 'single' && isAssistantRole(last.message.role)) {
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
    isStillExecuting,
  ]);

  return { staticItems, activeTurn, shouldRenderStreaming, hasAnyStreamContent };
}

export type { ChatDisplayItem };
