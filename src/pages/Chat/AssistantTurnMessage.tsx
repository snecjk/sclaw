import { memo, useMemo } from 'react';
import type { RawMessage, AttachedFileMeta } from '@/stores/chat';
import { useChatStore } from '@/stores/chat';
import { ChatMessage } from './ChatMessage';
import { appendWorkflowCardBlockToMessage, sessionHasParamsConfirmedWorkflowForRun } from '@/lib/workflow-card-injection';
import { mergeThinkingTimelines, pickAssistantReplyMessage } from './chat-display';
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
  const streamSources = useMemo(() => {
    const sources = [...turnMessages];
    if (activeStream?.streamMessage) {
      sources.push(activeStream.streamMessage);
    }
    return sources;
  }, [turnMessages, activeStream]);

  const mergedTimeline = useMemo(
    () => (showThinking ? mergeThinkingTimelines(streamSources) : []),
    [showThinking, streamSources],
  );

  const isStreaming = !!activeStream;
  const isConnecting = activeStream?.isConnecting ?? false;
  const isProcessing = activeStream?.isProcessing ?? false;
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
      isProcessing);

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

  const sessionMessages = useChatStore((s) => s.messages);

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
      streamingTools={streamingTools}
      connectingLabelKey={connectingLabelKey}
    />
  ) : null;

  if (((replyDisplayHasText || chatDisplayHasWorkflowCard) && chatDisplayMessage) || hasPreambleMessages) {
    return (
      <div className="group flex w-full flex-col gap-2" data-chat-message-role="assistant">
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
          />
        ))}
        {replyDisplayHasText || chatDisplayHasWorkflowCard ? (
          chatDisplayMessage ? (
          <ChatMessage
            message={chatDisplayMessage}
            showThinking={false}
            isSearchMatch={!!chatDisplayMessage.id && !!matchedMessageIds?.has(chatDisplayMessage.id)}
            isSearchActive={!!chatDisplayMessage.id && chatDisplayMessage.id === activeMessageId}
            isStreaming={isStreaming && replyDisplayHasText}
            streamingTools={isStreaming ? streamingTools : []}
            onPreviewFile={onPreviewFile}
            onCreateScheduledTask={onCreateScheduledTask}
            onEditMessage={onEditMessage}
            hideAvatar
            hideThinkingPanel
          />
          ) : null
        ) : null}
      </div>
    );
  }

  if (!showThinkingPanel && !hasDingTalkSentPreview) return null;

  if (hasDingTalkSentPreview) {
    return (
      <div className="group flex w-full flex-col gap-2" data-chat-message-role="assistant">
        {thinkingPanelEl}
        <DingTalkSentPreview previews={dingTalkSentPreviews} />
      </div>
    );
  }

  return (
    <div className="group w-full" data-chat-message-role="assistant">
      {thinkingPanelEl}
    </div>
  );
});
