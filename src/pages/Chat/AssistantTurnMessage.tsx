import { memo, useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import type { RawMessage, AttachedFileMeta } from '@/stores/chat';
import { ChatMessage } from './ChatMessage';
import { mergeThinkingTimelines, pickAssistantReplyMessage } from './chat-display';
import { extractDingTalkSentPreviews } from '../../../shared/dingtalk-sent-display';
import { extractAtMentionDisplayNames, extractRawMessageText, extractText } from './message-utils';
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
  activeStream?: ActiveTurnStream | null;
  onPreviewFile?: (file: AttachedFileMeta) => void;
  onViewWorkflow?: (workflowId: string) => void;
}

export const AssistantTurnMessage = memo(function AssistantTurnMessage({
  turnMessages,
  turnToolResults = [],
  precedingUserMessage = null,
  showThinking,
  activeStream = null,
  onPreviewFile,
  onViewWorkflow,
}: AssistantTurnMessageProps) {
  const streamSources = useMemo(() => {
    const sources = [...turnMessages];
    if (activeStream?.streamMessage) {
      sources.push(activeStream.streamMessage);
    }
    return sources;
  }, [turnMessages, activeStream?.streamMessage]);

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

  const replyHasText = replyMessage ? extractText(replyMessage).trim().length > 0 : false;

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

  if (!showThinkingPanel && !replyHasText && !hasDingTalkSentPreview) return null;

  const avatar = (
    <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-border bg-[linear-gradient(180deg,#FFF5E6,#FFE8CC)] text-primary shadow-[0_8px_20px_rgba(255,111,0,0.12)]">
      <Sparkles className="h-4 w-4" />
    </div>
  );

  if (replyHasText && replyMessage) {
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
            message={replyMessage}
            showThinking={false}
            isStreaming={isStreaming && replyHasText}
            streamingTools={[]}
            onPreviewFile={onPreviewFile}
            onViewWorkflow={onViewWorkflow}
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
