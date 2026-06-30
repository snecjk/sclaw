import { memo, useMemo } from 'react';
import type { RawMessage, AttachedFileMeta } from '@/stores/chat';
import { useChatStore } from '@/stores/chat';
import { ChatMessage } from './ChatMessage';
import { appendWorkflowCardBlockToMessage, sessionHasParamsConfirmedWorkflowForRun } from '@/lib/workflow-card-injection';
import { mergeThinkingTimelines, pickAssistantReplyMessage, findLastUserMessage } from './chat-display';
import {
  extractDingTalkSentPreviews,
  stripEchoedDingTalkSentBodiesFromAssistantReply,
} from '../../../shared/dingtalk-sent-display';
import {
  extractAtMentionDisplayNames,
  extractRawMessageText,
  extractText,
  extractWorkflowCard,
  extractParameterForm,
  findLatestWorkflowCardInMessages,
  isWorkflowPreambleAssistantMessage,
} from './message-utils';
import { DingTalkSentPreview } from './DingTalkSentPreview';
import { ThinkingProcessPanel, type ConnectingLabelKey } from './ThinkingProcessPanel';

type StreamingTool = {
  id?: string;
  toolCallId?: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  durationMs?: number;
  summary?: string;
};

export interface ActiveTurnStream {
  streamMessage: RawMessage | null;
  streamText: string;
  streamingTools: StreamingTool[];
  isConnecting: boolean;
  isProcessing: boolean;
  isStillExecuting?: boolean;
}

interface AssistantTurnMessageProps {
  turnMessages: RawMessage[];
  turnToolResults?: RawMessage[];
  precedingUserMessage?: RawMessage | null;
  showThinking: boolean;
  matchedMessageIds?: ReadonlySet<string>;
  activeMessageId?: string | null;
  activeStream?: ActiveTurnStream | null;
  onPreviewFile?: (file: AttachedFileMeta) => void;
  onCreateScheduledTask?: (workflowId: string) => void;
  onEditMessage?: (text: string) => void;
}

function normalizeMessageRole(role: unknown): string {
  return String(role ?? '').toLowerCase();
}

/** Skip tool_result rows; they are merged into the turn via turnToolResults for display. */
function isToolResultMessage(role: unknown): boolean {
  const normalized = normalizeMessageRole(role);
  return normalized === 'toolresult' || normalized === 'tool_result';
}

/**
 * During an active run, build the thinking/tool timeline from live session messages
 * (plus the in-flight stream buffer). Promoted turnMessages are tool_result snapshots
 * and lag behind; pickTimelineSourceMessages can also fold away stream-only updates.
 */
function collectActiveTurnStreamSources(
  sessionMessages: RawMessage[],
  turnMessages: RawMessage[],
  precedingUserMessage: RawMessage | null,
  activeStream: ActiveTurnStream,
): RawMessage[] {
  const anchorUser = precedingUserMessage ?? findLastUserMessage(sessionMessages);
  let startIndex = 0;
  if (anchorUser) {
    const byId = anchorUser.id
      ? sessionMessages.findIndex((message) => message.id === anchorUser.id)
      : -1;
    startIndex = byId >= 0 ? byId + 1 : sessionMessages.indexOf(anchorUser) + 1;
  }

  const sources: RawMessage[] = [];
  if (startIndex > 0) {
    for (let i = startIndex; i < sessionMessages.length; i += 1) {
      const message = sessionMessages[i];
      if (normalizeMessageRole(message.role) === 'user') break;
      if (isToolResultMessage(message.role)) continue;
      sources.push(message);
    }
  }

  if (sources.length === 0) {
    sources.push(...turnMessages);
  }

  if (activeStream.streamMessage) {
    sources.push(activeStream.streamMessage);
  }

  return sources;
}

export const AssistantTurnMessage = memo(function AssistantTurnMessage({
  turnMessages,
  turnToolResults = [],
  precedingUserMessage = null,
  showThinking,
  matchedMessageIds,
  activeMessageId = null,
  activeStream = null,
  onPreviewFile,
  onCreateScheduledTask,
  onEditMessage,
}: AssistantTurnMessageProps) {
  const sessionMessages = useChatStore((s) => s.messages);

  const streamSources = useMemo(() => {
    if (!activeStream) return turnMessages;
    return collectActiveTurnStreamSources(
      sessionMessages,
      turnMessages,
      precedingUserMessage,
      activeStream,
    );
  }, [sessionMessages, turnMessages, precedingUserMessage, activeStream]);

  const mergedTimeline = useMemo(
    () => (showThinking ? mergeThinkingTimelines(streamSources) : []),
    [showThinking, streamSources],
  );

  const isStreaming = !!activeStream;
  const isConnecting = activeStream?.isConnecting ?? false;
  const isProcessing = activeStream?.isProcessing ?? false;
  const isStillExecuting = activeStream?.isStillExecuting ?? false;
  const streamingTools = activeStream?.streamingTools ?? [];
  const pendingWorkflow = useChatStore((s) => s.pendingWorkflow);

  const connectingLabelKey = useMemo((): ConnectingLabelKey => {
    if (pendingWorkflow !== null) return 'connectingModel';
    const hasWorkflowInTurn = turnMessages.some((msg) => {
      if (msg.role !== 'assistant') return false;
      return extractWorkflowCard(msg) !== null || extractParameterForm(msg, pendingWorkflow) !== null;
    });
    return hasWorkflowInTurn ? 'connectingModel' : 'understandingQuestion';
  }, [turnMessages, pendingWorkflow]);

  const showThinkingPanel =
    showThinking &&
    (mergedTimeline.length > 0 ||
      streamingTools.length > 0 ||
      isConnecting ||
      isProcessing ||
      isStillExecuting);

  const replyMessage = useMemo(() => {
    const fromHistory = pickAssistantReplyMessage(turnMessages);
    const streamText = activeStream?.streamText?.trim() ?? '';
    if (streamText.length > 0) {
      const base = activeStream?.streamMessage ?? fromHistory ?? turnMessages[turnMessages.length - 1];
      if (!base) return null;
      return {
        ...base,
        role: 'assistant' as const,
        content: activeStream?.streamMessage?.content ?? streamText,
      } as RawMessage;
    }
    return fromHistory;
  }, [turnMessages, activeStream]);

  /** 分组参数 intro 等前置块（与 pickAssistantReplyMessage 选中的执行卡消息分开展示） */
  const preambleMessages = useMemo(() => {
    if (!replyMessage) return [];
    if (isWorkflowPreambleAssistantMessage(replyMessage)) return [];

    const candidates = turnMessages.filter((msg) => {
      if (msg.id && replyMessage.id && msg.id === replyMessage.id) return false;
      return isWorkflowPreambleAssistantMessage(msg);
    });
    if (candidates.length <= 1) return candidates;

    // 流式阶段可能连续追加多条 intro/摘要，仅保留最后一条 preamble
    return [candidates[candidates.length - 1]];
  }, [turnMessages, replyMessage]);

  const mentionHints = useMemo(() => {
    if (!precedingUserMessage) return [];
    return extractAtMentionDisplayNames(extractText(precedingUserMessage));
  }, [precedingUserMessage]);

  const userMessageRaw = useMemo(
    () => (precedingUserMessage ? extractRawMessageText(precedingUserMessage) : undefined),
    [precedingUserMessage],
  );

  const assistantReplyText = replyMessage ? extractText(replyMessage) : undefined;

  const dingTalkSentPreviews = useMemo(() => {
    if (isStreaming) return [];
    return extractDingTalkSentPreviews(turnMessages, turnToolResults, {
      mentionHints,
      userMessageRaw,
      assistantReplyText,
    });
  }, [isStreaming, turnMessages, turnToolResults, mentionHints, userMessageRaw, assistantReplyText]);

  const hasDingTalkSentPreview = dingTalkSentPreviews.length > 0;

  const replyDisplayMessage = useMemo(() => {
    if (!replyMessage || !hasDingTalkSentPreview || !assistantReplyText) return replyMessage;
    const stripped = stripEchoedDingTalkSentBodiesFromAssistantReply(
      assistantReplyText,
      dingTalkSentPreviews,
    );
    if (!stripped.trim()) return null;
    if (stripped.trim() === assistantReplyText.trim()) return replyMessage;
    return {
      ...replyMessage,
      content: stripped,
    } as RawMessage;
  }, [replyMessage, hasDingTalkSentPreview, assistantReplyText, dingTalkSentPreviews]);

  const replyDisplayHasText = replyDisplayMessage
    ? extractText(replyDisplayMessage).trim().length > 0
    : false;

  const chatDisplayMessage = useMemo(() => {
    if (!replyDisplayMessage) return null;
    if (extractWorkflowCard(replyDisplayMessage)) return replyDisplayMessage;
    const card = findLatestWorkflowCardInMessages(turnMessages);
    if (!card) return replyDisplayMessage;
    if (sessionHasParamsConfirmedWorkflowForRun(sessionMessages, card.runId)) {
      return replyDisplayMessage;
    }
    return appendWorkflowCardBlockToMessage(
      replyDisplayMessage,
      card.runId,
      card.templateName,
    );
  }, [replyDisplayMessage, turnMessages, sessionMessages]);

  const chatDisplayHasWorkflowCard = !!(
    chatDisplayMessage && extractWorkflowCard(chatDisplayMessage)
  );

  const replyTimestamp = useMemo(() => {
    if (chatDisplayMessage?.timestamp != null) return chatDisplayMessage.timestamp;
    for (let i = turnMessages.length - 1; i >= 0; i -= 1) {
      const ts = turnMessages[i]?.timestamp;
      if (ts != null) return ts;
    }
    return precedingUserMessage?.timestamp;
  }, [chatDisplayMessage, turnMessages, precedingUserMessage]);

  const chatDisplayMessageWithTimestamp = useMemo(() => {
    if (!chatDisplayMessage) return null;
    if (chatDisplayMessage.timestamp != null || replyTimestamp == null) return chatDisplayMessage;
    return { ...chatDisplayMessage, timestamp: replyTimestamp };
  }, [chatDisplayMessage, replyTimestamp]);

  const hasPreambleMessages = preambleMessages.length > 0;

  if (!showThinkingPanel && !replyDisplayHasText && !hasDingTalkSentPreview && !hasPreambleMessages && !chatDisplayHasWorkflowCard) {
    return null;
  }

  const thinkingPanelEl = showThinkingPanel ? (
    <ThinkingProcessPanel
      timeline={mergedTimeline}
      isStreaming={isStreaming}
      isConnecting={isConnecting}
      isProcessing={isProcessing}
      isStillExecuting={isStillExecuting}
      streamingTools={streamingTools}
      hasReplyBody={replyDisplayHasText}
      connectingLabelKey={connectingLabelKey}
    />
  ) : null;

  if (((replyDisplayHasText || chatDisplayHasWorkflowCard) && chatDisplayMessageWithTimestamp) || hasPreambleMessages) {
    return (
      <div className="flex w-full flex-col gap-4" data-chat-message-role="assistant">
        {thinkingPanelEl}
        {hasDingTalkSentPreview ? (
          <DingTalkSentPreview previews={dingTalkSentPreviews} />
        ) : null}
        {preambleMessages.map((preambleMessage) => (
          <ChatMessage
            key={preambleMessage.id ?? `preamble-${extractText(preambleMessage).slice(0, 24)}`}
            message={preambleMessage}
            showThinking={false}
            isSearchMatch={!!preambleMessage.id && !!matchedMessageIds?.has(preambleMessage.id)}
            isSearchActive={!!preambleMessage.id && preambleMessage.id === activeMessageId}
            onPreviewFile={onPreviewFile}
            onEditMessage={onEditMessage}
            hideAvatar
            hideThinkingPanel
            suppressToolCards={showThinking}
          />
        ))}
        {replyDisplayHasText || chatDisplayHasWorkflowCard ? (
          chatDisplayMessageWithTimestamp ? (
          <ChatMessage
            message={chatDisplayMessageWithTimestamp}
            showThinking={false}
            isSearchMatch={!!chatDisplayMessageWithTimestamp.id && !!matchedMessageIds?.has(chatDisplayMessageWithTimestamp.id)}
            isSearchActive={!!chatDisplayMessageWithTimestamp.id && chatDisplayMessageWithTimestamp.id === activeMessageId}
            isStreaming={isStreaming && replyDisplayHasText}
            streamingTools={isStreaming ? streamingTools : []}
            onPreviewFile={onPreviewFile}
            onCreateScheduledTask={onCreateScheduledTask}
            onEditMessage={onEditMessage}
            hideAvatar
            hideThinkingPanel
            suppressToolCards={showThinking}
          />
          ) : null
        ) : null}
      </div>
    );
  }

  if (!showThinkingPanel && !hasDingTalkSentPreview) return null;

  if (hasDingTalkSentPreview) {
    return (
      <div className="flex w-full flex-col gap-4" data-chat-message-role="assistant">
        {thinkingPanelEl}
        <DingTalkSentPreview previews={dingTalkSentPreviews} />
      </div>
    );
  }

  return (
    <div className="w-full" data-chat-message-role="assistant">
      {thinkingPanelEl}
    </div>
  );
});
