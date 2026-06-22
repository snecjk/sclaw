import { memo, useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import type { RawMessage, AttachedFileMeta } from '@/stores/chat';
import { ChatMessage } from './ChatMessage';
import { appendWorkflowCardBlockToMessage } from '@/lib/workflow-card-injection';
import { mergeThinkingTimelines, pickAssistantReplyMessage } from './chat-display';
import {
  extractDingTalkSentPreviews,
  stripEchoedDingTalkSentBodiesFromAssistantReply,
} from '../../../shared/dingtalk-sent-display';
import { extractAtMentionDisplayNames, extractRawMessageText, extractText, extractWorkflowCard, findLatestWorkflowCardInMessages } from './message-utils';
import { DingTalkSentPreview } from './DingTalkSentPreview';
import { ThinkingProcessPanel } from './ThinkingProcessPanel';

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
  onViewWorkflow?: (workflowId: string) => void;
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
  onViewWorkflow,
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
    return appendWorkflowCardBlockToMessage(
      replyDisplayMessage,
      card.runId,
      card.templateName,
    );
  }, [replyDisplayMessage, turnMessages]);

  const chatDisplayHasWorkflowCard = !!(
    chatDisplayMessage && extractWorkflowCard(chatDisplayMessage)
  );

  if (!showThinkingPanel && !replyDisplayHasText && !hasDingTalkSentPreview && !chatDisplayHasWorkflowCard) {
    return null;
  }

  const avatar = (
    <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-border bg-[linear-gradient(180deg,#FFF5E6,#FFE8CC)] text-primary shadow-[0_8px_20px_rgba(255,111,0,0.12)]">
      <Sparkles className="h-4 w-4" />
    </div>
  );

  if ((replyDisplayHasText || chatDisplayHasWorkflowCard) && chatDisplayMessage) {
    return (
      <div className="group flex flex-row gap-3" data-chat-message-role="assistant">
        {avatar}
        <div className="flex w-full min-w-0 max-w-[80%] flex-col items-start space-y-2">
          {showThinkingPanel ? (
            <ThinkingProcessPanel
              timeline={mergedTimeline}
              isStreaming={isStreaming}
              isConnecting={isConnecting}
              isProcessing={isProcessing}
              streamingTools={streamingTools}
            />
          ) : null}
          {hasDingTalkSentPreview ? (
            <DingTalkSentPreview previews={dingTalkSentPreviews} />
          ) : null}
          <ChatMessage
            message={chatDisplayMessage}
            showThinking={false}
            isSearchMatch={!!chatDisplayMessage.id && !!matchedMessageIds?.has(chatDisplayMessage.id)}
            isSearchActive={!!chatDisplayMessage.id && chatDisplayMessage.id === activeMessageId}
            isStreaming={isStreaming && replyDisplayHasText}
            streamingTools={[]}
            onPreviewFile={onPreviewFile}
            onViewWorkflow={onViewWorkflow}
            onCreateScheduledTask={onCreateScheduledTask}
            onEditMessage={onEditMessage}
            hideAvatar
            hideThinkingPanel
          />
        </div>
      </div>
    );
  }

  if (!showThinkingPanel && !hasDingTalkSentPreview) return null;

  if (hasDingTalkSentPreview) {
    return (
      <div className="group flex flex-row gap-3" data-chat-message-role="assistant">
        {avatar}
        <div className="flex w-full min-w-0 max-w-[80%] flex-col items-start space-y-2">
          {showThinkingPanel ? (
            <ThinkingProcessPanel
              timeline={mergedTimeline}
              isStreaming={isStreaming}
              isConnecting={isConnecting}
              isProcessing={isProcessing}
              streamingTools={streamingTools}
            />
          ) : null}
          <DingTalkSentPreview previews={dingTalkSentPreviews} />
        </div>
      </div>
    );
  }

  return (
    <div className="group flex flex-row gap-3" data-chat-message-role="assistant">
      {avatar}
      <div className="flex w-full min-w-0 max-w-[80%] flex-col">
        <ThinkingProcessPanel
          timeline={mergedTimeline}
          isStreaming={isStreaming}
          isConnecting={isConnecting}
          isProcessing={isProcessing}
          streamingTools={streamingTools}
        />
      </div>
    </div>
  );
});
