import { memo, useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import type { RawMessage, AttachedFileMeta } from '@/stores/chat';
import { ChatMessage } from './ChatMessage';
import { mergeThinkingTimelines, pickAssistantReplyMessage } from './chat-display';
import { extractText } from './message-utils';
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
  showThinking: boolean;
  activeStream?: ActiveTurnStream | null;
  onPreviewFile?: (file: AttachedFileMeta) => void;
}

export const AssistantTurnMessage = memo(function AssistantTurnMessage({
  turnMessages,
  showThinking,
  activeStream = null,
  onPreviewFile,
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

  if (!showThinkingPanel && !replyHasText) return null;

  const avatar = (
    <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-border bg-[linear-gradient(180deg,#FFF5E6,#FFE8CC)] text-primary shadow-[0_8px_20px_rgba(255,111,0,0.12)]">
      <Sparkles className="h-4 w-4" />
    </div>
  );

  if (replyHasText && replyMessage) {
    return (
      <div className="group flex flex-row gap-3">
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
          <ChatMessage
            message={replyMessage}
            showThinking={false}
            isStreaming={isStreaming && replyHasText}
            streamingTools={[]}
            onPreviewFile={onPreviewFile}
            hideAvatar
            hideThinkingPanel
          />
        </div>
      </div>
    );
  }

  if (!showThinkingPanel) return null;

  return (
    <div className="group flex flex-row gap-3">
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
