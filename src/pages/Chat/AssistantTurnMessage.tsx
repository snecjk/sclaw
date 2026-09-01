import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { RawMessage, AttachedFileMeta, ToolStatus } from '@/stores/chat';
import type { SkillMeta } from '@/types/skill-meta';
import { useChatStore } from '@/stores/chat';
import { useChatSessionEngineType } from '@/hooks/use-chat-session-engine-type';
import { ChatMessage } from './ChatMessage';
import { resolveChatMessageSearchKey } from './chat-message-search';
import {
  collectTurnAssistantSources,
  pickAssistantReplyMessage,
  resolveTurnChronologicalEntries,
  buildTurnStableKey,
} from './chat-display';
import { parseThinkingTurnLayoutCached, trimTrailingThinkingOnlyToolGroupSegments } from './thinking-turn-segments';
import {
  readTurnStreamingToolsCache,
  readTurnToolResultsCache,
  migrateTurnToolsCache,
  writeTurnStreamingToolsCache,
} from '@/lib/thinking-turn-tools-cache';
import { resolveDoneTurnStreamingTools } from '@/lib/thinking-done-tools';
import { consumeTurnInterrupted } from '@/lib/turn-interrupt-marker';
import {
  buildTurnDisplayCacheKey,
  migrateTurnDisplayCache,
  shouldPromoteActiveTurnCache,
} from '@/pages/Chat/thinking/segment-merge';
import {
  extractDingTalkSentPreviews,
  stripEchoedDingTalkSentBodiesFromAssistantReply,
} from '../../../shared/dingtalk-send/dingtalk-sent-display';
import {
  extractAtMentionDisplayNames,
  extractRawMessageText,
  extractText,
  extractParameterForm,
  isWorkflowPreambleAssistantMessage,
} from './message-utils';
import { extractFlowCard } from '@/lib/flow-card-patch';
import { isFlowCardCompanionText } from '@/lib/flow-card-marker';
import { DingTalkSentPreview } from './DingTalkSentPreview';
import { ThinkingTurnProcess, type ConnectingLabelKey } from './ThinkingProcessPanel';
import { resolveTurnProcessStatus } from '@/pages/Chat/thinking/turn-process-status';
import { processSegmentsCoverText, processSegmentsOwnText } from '@/pages/Chat/thinking/text-ownership';
import {
  dedupePhaseTextsAgainstFinalReply,
  isLikelyPlanningNarration,
  isLikelyUserClarificationReply,
} from '@/pages/Chat/thinking/classify-text';

type StreamingTool = ToolStatus;
const EMPTY_STREAMING_TOOLS: StreamingTool[] = [];
const EMPTY_STREAMING_TOOL_RESULTS: RawMessage[] = [];

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
  /** True only while the engine run is active; retained transcript overlays set this false. */
  isRunActive: boolean;
  isConnecting: boolean;
  isProcessing: boolean;
  isStillExecuting?: boolean;
}

interface AssistantTurnMessageProps {
  turnMessages: RawMessage[];
  sessionMessages: RawMessage[];
  turnToolResults?: RawMessage[];
  precedingUserMessage?: RawMessage | null;
  /** 与 buildChatDisplayItems 的 turn key 对齐，流式→完成 remount 时保留 timeline 缓存 */
  turnStableKey?: string;
  showThinking: boolean;
  matchedMessageKeys?: ReadonlySet<string>;
  activeMessageKey?: string | null;
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
  // Fresh background/cron trigger (no preceding user message): this activeTurn
  // is a brand-new run that must NOT inherit the previous turn's assistant
  // messages. Skip the session-history scan entirely — otherwise
  // findTurnStartIndex falls back to the previous user message and pulls the
  // previous completed answer into the connecting indicator. Only the live
  // streaming content is shown; the empty case renders just the loading
  // indicator (delegated to collectTurnAssistantSources with an empty history
  // so snapshot-replace/dedup logic stays shared).
  if (!precedingUserMessage) {
    return collectTurnAssistantSources(
      [],
      [...turnMessages, ...activeStream.streamingMessages],
      null,
      activeStream.streamMessage,
    );
  }
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
  sessionMessages,
  turnToolResults = [],
  precedingUserMessage = null,
  turnStableKey,
  showThinking,
  matchedMessageKeys,
  activeMessageKey = null,
  activeStream = null,
  onPreviewFile,
  onCreateScheduledTask,
  onEditMessage,
}: AssistantTurnMessageProps) {
  const pendingWorkflow = useChatStore(
    (s) => s.workflowChatUiBySessionKey[s.currentSessionKey]?.pendingWorkflow ?? null,
  );
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const engineType = useChatSessionEngineType();

  const isStreaming = activeStream?.isRunActive === true;
  const streamingTools = activeStream?.streamingTools ?? EMPTY_STREAMING_TOOLS;
  const streamingToolResults = activeStream?.streamingToolResults ?? EMPTY_STREAMING_TOOL_RESULTS;

  const [wasInterrupted, setWasInterrupted] = useState(false);
  useEffect(() => {
    if (!turnStableKey) return;
    if (consumeTurnInterrupted(turnStableKey)) {
      setWasInterrupted(true);
    }
  }, [turnStableKey]);

  const previousTurnStableKeyRef = useRef(turnStableKey);
  const previousTurnStableKey = previousTurnStableKeyRef.current;
  const shouldPromoteActiveCache = shouldPromoteActiveTurnCache(
    previousTurnStableKey,
    turnStableKey,
  );
  const turnDisplayCacheKey = buildTurnDisplayCacheKey(currentSessionKey, turnStableKey);
  const previousTurnDisplayCacheKey = buildTurnDisplayCacheKey(
    currentSessionKey,
    previousTurnStableKey,
  );
  if (shouldPromoteActiveCache) {
    migrateTurnDisplayCache(previousTurnDisplayCacheKey, turnDisplayCacheKey);
    migrateTurnToolsCache(previousTurnDisplayCacheKey, turnDisplayCacheKey);
  }
  previousTurnStableKeyRef.current = turnStableKey;

  if (turnDisplayCacheKey && streamingTools.length > 0) {
    writeTurnStreamingToolsCache(turnDisplayCacheKey, streamingTools);
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
    if (shouldPromoteActiveCache && previousTurnDisplayCacheKey) {
      aliases.push(previousTurnDisplayCacheKey);
    }
    const userKey = precedingUserMessage?.id
      ? buildTurnStableKey(precedingUserMessage, 0)
      : null;
    const userCacheKey = buildTurnDisplayCacheKey(currentSessionKey, userKey ?? undefined);
    if (userCacheKey && userCacheKey !== turnDisplayCacheKey && !aliases.includes(userCacheKey)) {
      aliases.push(userCacheKey);
    }
    return aliases;
  }, [
    currentSessionKey,
    precedingUserMessage,
    previousTurnDisplayCacheKey,
    shouldPromoteActiveCache,
    turnDisplayCacheKey,
  ]);

  const cachedToolResultsForTurn = useMemo(
    () => readTurnToolResultsCache(turnDisplayCacheKey, turnCacheAliasKeys),
    [turnDisplayCacheKey, turnCacheAliasKeys],
  );

  const chronologicalEntries = useMemo(() => {
    // Fresh background/cron trigger (active turn, no preceding user message):
    // this is a brand-new run — do NOT scan session history for the timeline,
    // otherwise walkTurnChronologicalEntries falls back to the previous user
    // message and bleeds the previous turn's tool calls into the connecting
    // indicator. Live tools still surface via bakedStreamingTools (streamingTools).
    if (activeStream && !precedingUserMessage) {
      return resolveTurnChronologicalEntries(
        [],
        null,
        turnMessages,
        [...turnToolResults, ...streamingToolResults],
      );
    }
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
    activeStream,
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
            turnStableKey: turnDisplayCacheKey,
            aliasKeys: turnCacheAliasKeys,
            turnMessages,
            toolResults:
              cachedToolResultsForTurn.length > 0
                ? cachedToolResultsForTurn
                : turnToolResults,
          })
        : readTurnStreamingToolsCache(turnDisplayCacheKey, turnCacheAliasKeys);
    return normalizeBakedStreamingTools(doneTools);
  }, [
    turnDisplayCacheKey,
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
      return extractParameterForm(msg, pendingWorkflow) !== null;
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
        ? parseThinkingTurnLayoutCached(turnDisplayCacheKey, streamSources, {
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
      turnDisplayCacheKey,
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
    // A completed run can still be displayed from the retained overlay while
    // authoritative transcript history catches up. Runtime activity controls
    // spinners and action locks; overlay presence controls the content source.
    const replySources = activeStream ? streamSources : turnMessages;
    const fromHistory = pickAssistantReplyMessage(replySources);
    const base = fromHistory ?? replySources[replySources.length - 1] ?? null;
    if (!base) return null;

    if (thinkingLayout.finalReplyText) {
      // finalReplyText comes from extractText(), which strips ```flow_card fences.
      // Re-attach the card from the raw history message so FlowCard still renders.
      const preservedCard = extractFlowCard(base);
      if (preservedCard) {
        return {
          ...base,
          role: 'assistant' as const,
          content: [preservedCard],
        } as RawMessage;
      }
      return {
        ...base,
        role: 'assistant' as const,
        content: thinkingLayout.finalReplyText,
      } as RawMessage;
    }

    if (fromHistory) {
      const fallbackText = extractText(fromHistory).trim();
      // Ownership 已把正文留给 process（finalReplyText === null）：勿再落气泡，避免「思考区 + 气泡」重复。
      if (fallbackText && processSegmentsOwnText(thinkingLayout.segments, fallbackText)) {
        return null;
      }

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

    return fromHistory;
  }, [turnMessages, streamSources, activeStream, thinkingLayout.finalReplyText, thinkingLayout.segments]);

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

  const chatDisplayMessage = replyDisplayMessage;
  const chatDisplayHasWorkflowCard = false;
  const chatDisplayHasFlowCard = Boolean(
    replyMessage && extractFlowCard(replyMessage),
  );

  const replyDisplayHasText = replyDisplayMessage
    ? (() => {
        const trimmed = extractText(replyDisplayMessage).trim();
        if (!trimmed) return false;
        if (chatDisplayHasFlowCard && isFlowCardCompanionText(trimmed)) return false;
        if (isStreaming && isFlowCardCompanionText(trimmed)) return false;
        return true;
      })()
    : false;

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
    || chatDisplayHasFlowCard
    || (!isStreaming && chatDisplayHasWorkflowCard);

  const thinkingSegmentsForDisplay = useMemo(() => {
    let segments = thinkingLayout.segments;
    // Sticky merge 可能把 ownership 已删掉的 phase-text 复活；相对 final 再去重一次。
    const finalForDedupe = thinkingLayout.finalReplyText?.trim() ?? null;
    if (finalForDedupe && segments.length > 0) {
      segments = [...segments];
      dedupePhaseTextsAgainstFinalReply(segments, finalForDedupe);
    }

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
          isStreaming && replyDisplayHasText && !isProcessing,
        hasVisibleFinalReply: replyDisplayHasText,
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

  if (!showThinkingPanel && !replyDisplayHasText && !hasDingTalkSentPreview && !hasPreambleMessages && !chatDisplayHasWorkflowCard && !chatDisplayHasFlowCard) {
    return null;
  }

  const thinkingPanelEl = showThinkingPanel ? (
    <ThinkingTurnProcess
      turnStableKey={turnDisplayCacheKey}
      segments={thinkingSegmentsForDisplay}
      isStreaming={isStreaming}
      isConnecting={isConnecting}
      isProcessing={isProcessing}
      isStillExecuting={isStillExecuting}
      streamingTools={bakedStreamingTools}
      hasFinalReply={hasThinkingFinalReply}
      finalReplyText={(() => {
        const raw = thinkingLayout.finalReplyText
          ?? (replyDisplayHasText && replyMessage ? extractText(replyMessage) : null);
        if (!raw?.trim()) return null;
        if (chatDisplayHasFlowCard && isFlowCardCompanionText(raw)) return null;
        if (isStreaming && isFlowCardCompanionText(raw)) return null;
        return raw;
      })()}
      connectingLabelKey={connectingLabelKey}
      processStatus={processStatus}
    />
  ) : null;

  if (((replyDisplayHasText || chatDisplayHasWorkflowCard || chatDisplayHasFlowCard) && chatDisplayMessageWithTimestamp) || hasPreambleMessages) {
    return (
      <div className="flex w-full flex-col gap-4" data-chat-message-role="assistant">
        {thinkingPanelEl}
        {hasDingTalkSentPreview ? (
          <DingTalkSentPreview previews={dingTalkSentPreviews} />
        ) : null}
        {preambleMessages.map((preambleMessage, preambleIndex) => {
          const searchKey = resolveChatMessageSearchKey(
            preambleMessage.id,
            `turn:${turnStableKey ?? 'unknown'}:preamble:${preambleIndex}`,
          );
          return (
          <ChatMessage
            key={preambleMessage.id ?? searchKey}
            message={preambleMessage}
            sessionMessages={sessionMessages}
            showThinking={false}
            searchMessageKey={searchKey}
            isSearchMatch={!!matchedMessageKeys?.has(searchKey)}
            isSearchActive={activeMessageKey === searchKey}
            onPreviewFile={onPreviewFile}
            onEditMessage={onEditMessage}
            hideAvatar
            hideThinkingPanel
            suppressToolCards={showThinking}
          />
          );
        })}
        {replyDisplayHasText || chatDisplayHasWorkflowCard || chatDisplayHasFlowCard ? (
          chatDisplayMessageWithTimestamp ? (() => {
            const replySearchKey = resolveChatMessageSearchKey(
              chatDisplayMessageWithTimestamp.id,
              `turn:${turnStableKey ?? 'unknown'}:reply`,
            );
            return (
            <ChatMessage
              message={chatDisplayMessageWithTimestamp}
              sessionMessages={sessionMessages}
              showThinking={false}
              searchMessageKey={replySearchKey}
              isSearchMatch={!!matchedMessageKeys?.has(replySearchKey)}
              isSearchActive={activeMessageKey === replySearchKey}
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
            );
          })() : null
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
