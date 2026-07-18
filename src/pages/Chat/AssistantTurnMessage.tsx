import { memo, useEffect, useMemo, useState } from 'react';
import type { RawMessage, AttachedFileMeta, ToolStatus } from '@/stores/chat';
import type { SkillMeta } from '@/types/skill-meta';
import { useChatStore } from '@/stores/chat';
import { useChatSessionEngineType } from '@/hooks/use-chat-session-engine-type';
import { ChatMessage } from './ChatMessage';
import { appendWorkflowCardBlockToMessage, sessionHasParamsConfirmedWorkflowForRun } from '@/lib/workflow-card-injection';
import {
  collectTurnAssistantSources,
  pickAssistantReplyMessage,
  resolveTurnChronologicalEntries,
  buildTurnStableKey,
} from './chat-display';
import { parseThinkingTurnLayout, trimTrailingThinkingOnlyToolGroupSegments } from './thinking-turn-segments';
import {
  readTurnStreamingToolsCache,
  readTurnToolResultsCache,
  writeTurnStreamingToolsCache,
} from '@/lib/thinking-turn-tools-cache';
import { resolveDoneTurnStreamingTools } from '@/lib/thinking-done-tools';
import { consumeTurnInterrupted } from '@/lib/turn-interrupt-marker';
import { migrateTurnDisplayCache } from '@/pages/Chat/thinking/segment-merge';
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
import { ThinkingTurnProcess, type ConnectingLabelKey } from './ThinkingProcessPanel';
import { resolveTurnProcessStatus } from '@/pages/Chat/thinking/turn-process-status';
import { processSegmentsCoverText } from '@/pages/Chat/thinking/text-ownership';
import {
  isLikelyPlanningNarration,
  isLikelyUserClarificationReply,
} from '@/pages/Chat/thinking/classify-text';

type StreamingTool = ToolStatus;

type BakedStreamingToolLike = {
  id?: string;
  toolCallId?: string;
  name: string;
  status?: 'running' | 'completed' | 'error';
  input?: unknown;
  durationMs?: number;
  summary?: string;
  updatedAt?: number;
};

function normalizeBakedStreamingTools(tools: readonly BakedStreamingToolLike[]): ToolStatus[] {
  const now = Date.now();
  return tools.map((tool, index) => ({
    id: tool.id,
    toolCallId: tool.toolCallId,
    name: tool.name,
    status: tool.status ?? 'completed',
    input: tool.input,
    durationMs: tool.durationMs,
    summary: tool.summary,
    updatedAt: tool.updatedAt ?? now + index,
  }));
}

export interface ActiveTurnStream {
  streamMessage: RawMessage | null;
  streamText: string;
  streamingTools: StreamingTool[];
  streamingMessages: RawMessage[];
  streamingToolResults: RawMessage[];
  isConnecting: boolean;
  isProcessing: boolean;
  isStillExecuting?: boolean;
}

interface AssistantTurnMessageProps {
  turnMessages: RawMessage[];
  turnToolResults?: RawMessage[];
  precedingUserMessage?: RawMessage | null;
  /** 与 buildChatDisplayItems 的 turn key 对齐，流式→完成 remount 时保留 timeline 缓存 */
  turnStableKey?: string;
  showThinking: boolean;
  matchedMessageIds?: ReadonlySet<string>;
  activeMessageId?: string | null;
  activeStream?: ActiveTurnStream | null;
  onPreviewFile?: (file: AttachedFileMeta) => void;
  onCreateScheduledTask?: (workflowId: string) => void;
  onEditMessage?: (text: string, skillMeta?: SkillMeta) => void;
}

function collectActiveTurnStreamSources(
  sessionMessages: RawMessage[],
  turnMessages: RawMessage[],
  precedingUserMessage: RawMessage | null,
  activeStream: ActiveTurnStream,
): RawMessage[] {
  const sources = collectTurnAssistantSources(
    sessionMessages,
    [...turnMessages, ...activeStream.streamingMessages],
    precedingUserMessage,
    activeStream.streamMessage,
  );
  return sources;
}

export const AssistantTurnMessage = memo(function AssistantTurnMessage({
  turnMessages,
  turnToolResults = [],
  precedingUserMessage = null,
  turnStableKey,
  showThinking,
  matchedMessageIds,
  activeMessageId = null,
  activeStream = null,
  onPreviewFile,
  onCreateScheduledTask,
  onEditMessage,
}: AssistantTurnMessageProps) {
  const sessionMessages = useChatStore((s) => s.messages);
  const pendingWorkflow = useChatStore((s) => s.pendingWorkflow);
  const engineType = useChatSessionEngineType();

  const isStreaming = !!activeStream;
  const streamingTools = activeStream?.streamingTools ?? [];
  const streamingToolResults = activeStream?.streamingToolResults ?? [];

  const [wasInterrupted, setWasInterrupted] = useState(false);
  useEffect(() => {
    if (!turnStableKey) return;
    if (consumeTurnInterrupted(turnStableKey)) {
      setWasInterrupted(true);
    }
  }, [turnStableKey]);

  if (turnStableKey && turnStableKey !== 'active-turn') {
    migrateTurnDisplayCache('active-turn', turnStableKey);
  }

  if (turnStableKey && streamingTools.length > 0) {
    writeTurnStreamingToolsCache(turnStableKey, streamingTools);
  }

  const streamSources = useMemo(() => {
    if (activeStream) {
      return collectActiveTurnStreamSources(
        sessionMessages,
        turnMessages,
        precedingUserMessage,
        activeStream,
      );
    }
    return collectTurnAssistantSources(sessionMessages, turnMessages, precedingUserMessage);
  }, [sessionMessages, turnMessages, precedingUserMessage, activeStream]);

  const turnCacheAliasKeys = useMemo(() => {
    const aliases: string[] = [];
    if (turnStableKey !== 'active-turn') {
      aliases.push('active-turn');
    }
    const userKey = precedingUserMessage?.id
      ? buildTurnStableKey(precedingUserMessage, 0)
      : null;
    if (userKey && userKey !== turnStableKey && !aliases.includes(userKey)) {
      aliases.push(userKey);
    }
    return aliases;
  }, [precedingUserMessage, turnStableKey]);

  const cachedToolResultsForTurn = useMemo(
    () => readTurnToolResultsCache(turnStableKey, turnCacheAliasKeys),
    [turnStableKey, turnCacheAliasKeys],
  );

  const chronologicalEntries = useMemo(() => {
    const cachedToolResults = cachedToolResultsForTurn;
    const toolResults =
      cachedToolResults.length > 0
        ? cachedToolResults
        : [...turnToolResults, ...streamingToolResults];
    return resolveTurnChronologicalEntries(
      sessionMessages,
      precedingUserMessage,
      turnMessages,
      toolResults,
    );
  }, [
    sessionMessages,
    precedingUserMessage,
    turnMessages,
    turnToolResults,
    streamingToolResults,
    cachedToolResultsForTurn,
  ]);

  const bakedStreamingTools = useMemo((): ToolStatus[] => {
    if (isStreaming && streamingTools.length > 0) return streamingTools;
    const doneTools =
      engineType === 'claude'
        ? resolveDoneTurnStreamingTools({
            turnStableKey,
            aliasKeys: turnCacheAliasKeys,
            turnMessages,
            toolResults:
              cachedToolResultsForTurn.length > 0
                ? cachedToolResultsForTurn
                : turnToolResults,
          })
        : readTurnStreamingToolsCache(turnStableKey, turnCacheAliasKeys);
    return normalizeBakedStreamingTools(doneTools);
  }, [
    turnStableKey,
    turnCacheAliasKeys,
    isStreaming,
    streamingTools,
    engineType,
    turnMessages,
    cachedToolResultsForTurn,
    turnToolResults,
  ]);

  const connectingLabelKey = useMemo((): ConnectingLabelKey => {
    if (pendingWorkflow !== null) return 'connectingModel';
    const hasWorkflowInTurn = turnMessages.some((msg) => {
      if (msg.role !== 'assistant') return false;
      return extractWorkflowCard(msg) !== null || extractParameterForm(msg, pendingWorkflow) !== null;
    });
    return hasWorkflowInTurn ? 'connectingModel' : 'understandingQuestion';
  }, [turnMessages, pendingWorkflow]);

  const isConnecting = activeStream?.isConnecting ?? false;
  const isProcessing = activeStream?.isProcessing ?? false;
  const isStillExecuting = activeStream?.isStillExecuting ?? false;

  const precedingUserText = useMemo(() => {
    if (precedingUserMessage) {
      return extractText(precedingUserMessage).trim() || null;
    }
    return null;
  }, [precedingUserMessage]);

  const thinkingLayout = useMemo(
    () =>
      showThinking
        ? parseThinkingTurnLayout(streamSources, {
            isLiveStream: isStreaming,
            streamingTools:
              bakedStreamingTools.length > 0 ? bakedStreamingTools : undefined,
            chronologicalEntries:
              chronologicalEntries.length > 0 ? chronologicalEntries : undefined,
            precedingUserText,
            engineProfile: engineType,
            wasInterrupted,
          })
        : { segments: [], finalReplyText: null },
    [
      showThinking,
      streamSources,
      isStreaming,
      bakedStreamingTools,
      chronologicalEntries,
      precedingUserText,
      engineType,
      wasInterrupted,
    ],
  );

  const showThinkingPanel =
    showThinking &&
    (thinkingLayout.segments.length > 0 ||
      bakedStreamingTools.length > 0 ||
      isConnecting ||
      isProcessing ||
      isStillExecuting);

  const replyMessage = useMemo(() => {
    const replySources = isStreaming ? streamSources : turnMessages;
    const fromHistory = pickAssistantReplyMessage(replySources);
    const base = fromHistory ?? replySources[replySources.length - 1] ?? null;
    if (!base) return null;

    if (thinkingLayout.finalReplyText) {
      return {
        ...base,
        role: 'assistant' as const,
        content: thinkingLayout.finalReplyText,
      } as RawMessage;
    }

    if (fromHistory) {
      const fallbackText = extractText(fromHistory).trim();

      const coveredByThinking = processSegmentsCoverText(
        thinkingLayout.segments,
        fallbackText,
      );

      // 工具前旁白已在思考区展示时，不再重复生成正文气泡；参数追问正文优先
      if (
        coveredByThinking
        && isLikelyPlanningNarration(fallbackText)
        && !isLikelyUserClarificationReply(fallbackText)
      ) {
        return null;
      }
    }

    if (isStreaming) return fromHistory;

    return fromHistory;
  }, [turnMessages, streamSources, isStreaming, thinkingLayout.finalReplyText, thinkingLayout.segments]);

  const preambleMessages = useMemo(() => {
    if (!replyMessage) return [];

    const phaseTextsInThinking = new Set(
      thinkingLayout.segments
        .filter((segment) => segment.kind === 'phase-text')
        .map((segment) => segment.text.trim()),
    );
    const isCoveredByThinkingPhaseText = (text: string): boolean => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      if (phaseTextsInThinking.has(trimmed)) return true;
      for (const phase of phaseTextsInThinking) {
        if (phase.startsWith(trimmed) || trimmed.startsWith(phase)) return true;
      }
      return false;
    };

    if (isWorkflowPreambleAssistantMessage(replyMessage)) return [];

    const candidates = turnMessages.filter((msg) => {
      if (msg.id && replyMessage.id && msg.id === replyMessage.id) return false;
      if (!isWorkflowPreambleAssistantMessage(msg)) return false;
      return !isCoveredByThinkingPhaseText(extractText(msg));
    });
    if (candidates.length <= 1) return candidates;

    return [candidates[candidates.length - 1]];
  }, [turnMessages, replyMessage, thinkingLayout.segments]);

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

  const hasThinkingFinalReply =
    replyDisplayHasText
    || hasPreambleMessages
    || (!isStreaming && chatDisplayHasWorkflowCard);

  const thinkingSegmentsForDisplay = useMemo(() => {
    const { segments } = thinkingLayout;
    if (isStreaming || segments.length === 0) return segments;

    const replyShownOutside =
      hasPreambleMessages
      || replyDisplayHasText
      || Boolean(thinkingLayout.finalReplyText?.trim());
    if (!replyShownOutside) return segments;

    return trimTrailingThinkingOnlyToolGroupSegments(segments);
  }, [
    thinkingLayout.segments,
    thinkingLayout.finalReplyText,
    isStreaming,
    hasPreambleMessages,
    replyDisplayHasText,
  ]);

  const processStatus = useMemo(
    () =>
      resolveTurnProcessStatus({
        isLiveStream:
          isStreaming || isConnecting || isProcessing || isStillExecuting,
        isConnecting,
        isProcessing,
        isStillExecuting,
        streamingTools: bakedStreamingTools,
        hasProcessSegments:
          thinkingSegmentsForDisplay.length > 0 || bakedStreamingTools.length > 0,
        hasFinalReplyStreaming:
          isStreaming && replyDisplayHasText,
      }),
    [
      isStreaming,
      isConnecting,
      isProcessing,
      isStillExecuting,
      bakedStreamingTools,
      thinkingSegmentsForDisplay.length,
      replyDisplayHasText,
    ],
  );

  if (!showThinkingPanel && !replyDisplayHasText && !hasDingTalkSentPreview && !hasPreambleMessages && !chatDisplayHasWorkflowCard) {
    return null;
  }

  const thinkingPanelEl = showThinkingPanel ? (
    <ThinkingTurnProcess
      turnStableKey={turnStableKey}
      segments={thinkingSegmentsForDisplay}
      isStreaming={isStreaming}
      isConnecting={isConnecting}
      isProcessing={isProcessing}
      isStillExecuting={isStillExecuting}
      streamingTools={bakedStreamingTools}
      hasFinalReply={hasThinkingFinalReply}
      connectingLabelKey={connectingLabelKey}
      processStatus={processStatus}
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
              isTurnDisplayReply
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
