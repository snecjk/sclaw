import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { chatRemarkPlugins } from '@/lib/remark-gfm-chat';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { resolveChatThinkingIcon } from '@/lib/chat-process-icons';
import { resolveChatToolDisplayName } from '@/lib/chat-tool-display-name';
import {
  chatProcessBlockBodyClass,
  ChatProcessBlock,
} from '@/components/chat/chat-process-block';
import { useTypewriterReveal } from '@/hooks/use-typewriter-reveal';
import { useSequentialTypewriterQueue } from '@/hooks/use-sequential-typewriter-queue';
import { ChatProcessLoadingEllipsis } from '@/components/chat/chat-process-loading-ellipsis';
import {
  ChatProcessLoadingIndicator,
  ChatProcessLoadingInlineIndicator,
} from '@/components/chat/chat-process-loading-indicator';
import { ChatToolCallCard } from '@/components/chat/chat-tool-call-card';
import { chatThinkingSegmentSummaryHeaderClass } from '@/lib/surfaces';
import {
  timelineBlockResetKey,
  toolRowKey,
  streamingToolKey,
  mergeTimelineMonotonic,
  appendStreamingExtrasToTimeline,
} from '@/lib/thinking-timeline-active';
import { useSkillsStore } from '@/stores/skills';
import type { ToolStatus } from '@/stores/chat/types';
import {
  hasDisplayableToolInput,
  maskDwsSensitiveIdsForDisplay,
  type ThinkingTimelineItem,
} from '@/pages/Chat/message-utils';
import { OPENING_PHASE_TEXT_KEY, INTERRUPTED_PHASE_TEXT_KEY } from '@/pages/Chat/thinking/types';
import { PhaseTextBlock } from '@/pages/Chat/thinking/phase-text-block';
import {
  mergeAdjacentOrphanedThinkingAndToolGroups,
  pruneDuplicateToolOnlyGroups,
  relocateInterruptPhaseBetweenAdjacentToolGroups,
} from '@/pages/Chat/thinking/adjacent-group-phase';
import { dedupePhaseTextsAgainstFinalReply } from '@/pages/Chat/thinking/classify-text';
import { classifyTextOverlap } from '@/pages/Chat/thinking/text-ownership';
import {
  mergeSegmentsMonotonic,
  mergeTurnSegmentMonotonic,
  readGlobalStableSegments,
  readGlobalStableTimeline,
  writeGlobalStableSegments,
  writeGlobalStableTimeline,
} from '@/pages/Chat/thinking/segment-merge';
import { isChronologicallyOrderedLayout } from '@/pages/Chat/thinking/done-segment-normalize';
import {
  resolveProcessStatusLabelKey,
  shouldShowProcessStatusLoading,
  type TurnProcessStatus,
} from '@/pages/Chat/thinking/turn-process-status';
import {
  rebalanceThinkingTimelineForDisplay,
  buildThinkingGroupSummaryLabel,
  type ThinkingToolGroupSegment,
  type ThinkingTurnSegment,
} from '@/pages/Chat/thinking-turn-segments';

/** 无外层卡片：思考过程直接铺在对话区底色上 */
const thinkingPanelRootClass = 'w-full';

/** 一级摘要 / phase-text / loading 之间垂直间距 */
const thinkingProcessSegmentStackClass = 'flex flex-col gap-3';

/** chat-interaction-style-spec §5.6：高度 0↔auto，300ms ease */
const thinkingPanelBodyGridClass = (expanded: boolean, animate: boolean) =>
  cn(
    'grid transition-[grid-template-rows]',
    animate ? 'duration-300 ease-[ease]' : 'transition-none',
    expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
  );

/** §5.6 / §6.2：箭头 200ms ease；收起向下，展开向上（rotate-180） */
const thinkingPanelChevronClass = (expanded: boolean, animate: boolean) =>
  cn(
    'h-3.5 w-3.5 shrink-0 opacity-70 transition-transform',
    animate ? 'duration-200 ease-[ease]' : 'transition-none',
    expanded && 'rotate-180',
  );

type StreamingTool = ToolStatus;

export type ConnectingLabelKey = 'connectingModel' | 'understandingQuestion' | 'stillExecuting';

export interface ConnectingModelIndicatorProps {
  className?: string;
  labelKey?: ConnectingLabelKey;
}

export function ConnectingModelIndicator({
  className,
  labelKey = 'understandingQuestion',
}: ConnectingModelIndicatorProps) {
  const { t } = useTranslation('chat');

  return (
    <ChatProcessLoadingInlineIndicator
      className={className}
      label={t(`streaming.${labelKey}`)}
    />
  );
}

export function AwaitingReplyIndicator({ className }: { className?: string }) {
  const { t } = useTranslation('chat');

  return (
    <ChatProcessLoadingInlineIndicator
      className={className}
      label={t('streaming.awaitingReply')}
    />
  );
}

function ThinkingBlockBody({
  content,
  isTypewriterActive,
  resetKey,
  onRevealComplete,
}: {
  content: string;
  isTypewriterActive: boolean;
  resetKey: string;
  onRevealComplete?: () => void;
}) {
  const { text: displayed, isAnimating } = useTypewriterReveal(content, isTypewriterActive, {
    resetKey,
  });

  useEffect(() => {
    if (!isTypewriterActive || isAnimating) return;
    if (displayed.length < content.length) return;
    onRevealComplete?.();
  }, [isTypewriterActive, isAnimating, displayed, content.length, onRevealComplete]);

  if (isTypewriterActive || isAnimating) {
    return (
      <p
        className={cn(chatProcessBlockBodyClass, 'whitespace-pre-wrap')}
        aria-busy={isTypewriterActive || isAnimating ? true : undefined}
      >
        {displayed}
        {isTypewriterActive ? <ChatProcessLoadingEllipsis /> : null}
      </p>
    );
  }

  return (
    <div
      className={cn(
        'prose prose-sm max-w-none dark:prose-invert',
        chatProcessBlockBodyClass,
      )}
    >
      <ReactMarkdown remarkPlugins={chatRemarkPlugins}>{content}</ReactMarkdown>
    </div>
  );
}

function resolveSkillDisplayName(
  name: string,
  skills: { id: string; slug?: string; name: string; title?: string }[],
): string {
  if (!name) return name;
  const skill = skills.find(
    (s) =>
      s.id === name
      || s.slug === name
      || s.id.toLowerCase() === name.toLowerCase()
      || s.slug?.toLowerCase() === name.toLowerCase(),
  );
  const skillLabel = skill?.title || skill?.name;
  if (skillLabel) return skillLabel;
  return resolveChatToolDisplayName(name);
}

function resolveSkillNamesInThinking(
  text: string,
  skills: { id: string; slug?: string; name: string; title?: string }[],
): string {
  if (!text || skills.length === 0) return text;

  const replacements = new Map<string, string>();
  for (const s of skills) {
    const title = s.title?.trim();
    if (!title) continue;
    if (s.name && s.name !== title) replacements.set(s.name, title);
    if (s.slug && s.slug !== title) replacements.set(s.slug, title);
    if (s.id && s.id !== title) replacements.set(s.id, title);
  }

  const sortedKeys = Array.from(replacements.keys()).sort((a, b) => b.length - a.length);
  if (sortedKeys.length === 0) return text;

  let result = text;
  for (const key of sortedKeys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?<![A-Za-z0-9_\\-])${escaped}(?![A-Za-z0-9_\\-])`, 'g');
    result = result.replace(regex, replacements.get(key)!);
  }
  return result;
}

function resolveTimelineBlockCollapseState(
  index: number,
  timelineLength: number,
  isLiveStream: boolean,
  batchIsCompleted: boolean,
  sequentialIndex: number | null,
): { isComplete: boolean; autoExpand: boolean; isActive: boolean } {
  // 批次已结束（或回合 done）→ 二级块收起；正文开始流式 ≠ 批次结束
  if (!isLiveStream || batchIsCompleted) {
    return { isComplete: true, autoExpand: false, isActive: false };
  }

  const isLastIndex = index === timelineLength - 1;
  // 顺序打字机轮到某块时以该块为「进行中」；否则以 timeline 末项为进行中（整理工具结果等）
  const isInProgress =
    sequentialIndex !== null ? index === sequentialIndex : isLastIndex;

  return {
    isComplete: !isInProgress,
    autoExpand: isInProgress,
    isActive: isInProgress,
  };
}

interface TimelineBodyProps {
  timeline: ThinkingTimelineItem[];
  isLiveStream: boolean;
  hasFinalReply: boolean;
  /** 当前 tool-group 批次是否已收成一级摘要（与 hasFinalReply 解耦） */
  batchIsCompleted: boolean;
  streamingTools: StreamingTool[];
  enableProcessTypewriter: boolean;
  isConnecting: boolean;
  isProcessing: boolean;
  isStillExecuting: boolean;
  connectingLabelKey: ConnectingLabelKey;
  readonlyExpanded?: boolean;
}

function TimelineBody({
  timeline,
  isLiveStream,
  hasFinalReply: _hasFinalReply,
  batchIsCompleted,
  streamingTools,
  enableProcessTypewriter,
  isConnecting: _isConnecting,
  isProcessing: _isProcessing,
  isStillExecuting: _isStillExecuting,
  connectingLabelKey: _connectingLabelKey,
  readonlyExpanded = false,
}: TimelineBodyProps) {
  const { t } = useTranslation('chat');
  const skills = useSkillsStore((state) => state.skills);
  const ThinkingIcon = resolveChatThinkingIcon();

  const streamingStatusByKey = useMemo(() => {
    const map = new Map<string, StreamingTool['status']>();
    for (const tool of streamingTools) {
      map.set(streamingToolKey(tool), tool.status);
    }
    return map;
  }, [streamingTools]);

  const { markBlockRevealFinished, getBlockRevealState, sequentialIndex } = useSequentialTypewriterQueue(
    timeline,
    enableProcessTypewriter,
  );

  const level2Collapsible = isLiveStream && !readonlyExpanded;

  return (
    <div className={cn(isLiveStream ? 'space-y-3' : 'space-y-3 pb-1 pt-1')}>
      {timeline.map((item, i) => {
        const blockResetKey = timelineBlockResetKey(item, i);
        const reveal = getBlockRevealState(i, blockResetKey);
        if (!reveal.isVisible) return null;

        if (item.type === 'thinking') {
          // 深度思考面板不走 extractThinking/cleanThinkingText，展示前需单独脱敏
          const thinkingContent = maskDwsSensitiveIdsForDisplay(
            resolveSkillNamesInThinking(item.content, skills),
          );
          const collapse = resolveTimelineBlockCollapseState(
            i,
            timeline.length,
            isLiveStream,
            batchIsCompleted,
            sequentialIndex,
          );
          return (
            <ChatProcessBlock
              key={blockResetKey}
              title={t('streaming.deepThinkingLabel')}
              icon={ThinkingIcon}
              collapsible={level2Collapsible}
              isComplete={collapse.isComplete}
              autoExpand={collapse.autoExpand}
              isActive={collapse.isActive}
            >
              <ThinkingBlockBody
                content={thinkingContent}
                isTypewriterActive={reveal.isTypewriterActive}
                resetKey={blockResetKey}
                onRevealComplete={() => markBlockRevealFinished(blockResetKey)}
              />
            </ChatProcessBlock>
          );
        }

        if (item.type !== 'tool') return null;

        const key = toolRowKey(item);
        const toolStatus = streamingStatusByKey.get(key);
        const collapse = resolveTimelineBlockCollapseState(
          i,
          timeline.length,
          isLiveStream,
          batchIsCompleted,
          sequentialIndex,
        );
        return (
          <ChatToolCallCard
            key={key}
            name={item.name}
            displayName={resolveSkillDisplayName(item.name, skills)}
            input={item.input}
            status={toolStatus}
            variant="readonly"
            presentation="thinkingProcess"
            thinkingProcessCollapsible={level2Collapsible}
            isComplete={collapse.isComplete}
            autoExpand={collapse.autoExpand}
            isActive={collapse.isActive}
            isInputTypewriterActive={reveal.isTypewriterActive && hasDisplayableToolInput(item.input)}
            typewriterResetKey={blockResetKey}
            onInputRevealComplete={() => markBlockRevealFinished(blockResetKey)}
            isAwaitingToolInput={
              reveal.isTypewriterActive && !hasDisplayableToolInput(item.input) && toolStatus === 'running'
            }
          />
        );
      })}
    </div>
  );
}

/** 正文流式中：最后一批 completed 不收成一级摘要，避免 remount 重播 */
function shouldDeferCompletedSummaryCollapse(
  segments: ThinkingTurnSegment[],
  segment: ThinkingToolGroupSegment,
  isLiveStream: boolean,
): boolean {
  if (!isLiveStream || segment.state !== 'completed') return false;

  const segmentIndex = segments.findIndex(
    (item) => item.kind === 'tool-group' && item.key === segment.key,
  );
  if (segmentIndex < 0) return false;

  const trailing = segments.slice(segmentIndex + 1);
  if (
    trailing.some(
      (item) => item.kind === 'phase-text' && item.key !== OPENING_PHASE_TEXT_KEY,
    )
  ) {
    return false;
  }
  if (trailing.some((item) => item.kind === 'tool-group')) {
    return false;
  }

  return true;
}

function useStableThinkingTimeline(
  turnStableKey: string | undefined,
  segmentKey: string,
  timeline: ThinkingTimelineItem[],
  isLiveStream: boolean,
  streamingTools: StreamingTool[] = [],
  mergeStreamingExtras = false,
): ThinkingTimelineItem[] {
  const cacheRef = useRef<Map<string, ThinkingTimelineItem[]>>(new Map());

  return useMemo(() => {
    let incoming = timeline;
    if (mergeStreamingExtras && streamingTools.length > 0) {
      incoming = rebalanceThinkingTimelineForDisplay(
        appendStreamingExtrasToTimeline(timeline, streamingTools),
      );
    }

    const globalCached = readGlobalStableTimeline(turnStableKey, segmentKey);
    const localCached = cacheRef.current.get(segmentKey) ?? [];
    const cached = globalCached.length >= localCached.length ? globalCached : localCached;
    const merged = mergeTimelineMonotonic(cached, incoming);

    if (merged.length >= cached.length || !isLiveStream) {
      if (merged.length > 0 || incoming.length > 0) {
        const next = merged.length > 0 ? merged : incoming;
        cacheRef.current.set(segmentKey, next);
        writeGlobalStableTimeline(turnStableKey, segmentKey, next);
      }
    }

    if (merged.length > 0) return merged;
    if (cached.length > 0) return cached;
    return incoming;
  }, [turnStableKey, segmentKey, timeline, isLiveStream, streamingTools, mergeStreamingExtras]);
}

function useStableThinkingSegments(
  turnStableKey: string | undefined,
  segments: ThinkingTurnSegment[],
  isLiveStream: boolean,
  finalReplyText: string | null = null,
): ThinkingTurnSegment[] {
  const cacheRef = useRef<ThinkingTurnSegment[]>([]);

  return useMemo(() => {
    const finalize = (next: ThinkingTurnSegment[]): ThinkingTurnSegment[] => {
      if (finalReplyText?.trim() && next.length > 0) {
        const copy = [...next];
        dedupePhaseTextsAgainstFinalReply(copy, finalReplyText);
        cacheRef.current = copy;
        writeGlobalStableSegments(turnStableKey, copy);
        return copy;
      }
      cacheRef.current = next;
      writeGlobalStableSegments(turnStableKey, next);
      return next;
    };

    const globalCached = readGlobalStableSegments(turnStableKey);
    const cached =
      globalCached.length >= cacheRef.current.length ? globalCached : cacheRef.current;
    if (segments.length === 0) {
      if (!isLiveStream) return segments;
      // Incoming cleared (ownership moved text to final): do not resurrect phase-text cache.
      if (finalReplyText?.trim()) {
        const toolsOnly = cached.filter((segment) => segment.kind === 'tool-group');
        return finalize(toolsOnly);
      }
      return cached.length > 0 ? cached : segments;
    }

    // 完成态以解析器 segment 结构为准，仅按 key 单调合并 timeline，避免流式双摘要缓存残留
    if (!isLiveStream) {
      const cachedByKey = new Map(cached.map((segment) => [segment.key, segment]));
      const reconciled = segments.map((segment) => {
        const previous = cachedByKey.get(segment.key);
        return previous ? mergeTurnSegmentMonotonic(previous, segment) : segment;
      });
      relocateInterruptPhaseBetweenAdjacentToolGroups(reconciled);
      mergeAdjacentOrphanedThinkingAndToolGroups(reconciled);
      pruneDuplicateToolOnlyGroups(reconciled);
      return finalize(reconciled);
    }

    // live：解析器产出交替结构时以 incoming 为准，避免 cache append 把 phase-text 堆到末尾
    if (isLiveStream && isChronologicallyOrderedLayout(segments)) {
      const cachedByKey = new Map(cached.map((segment) => [segment.key, segment]));
      const reconciled = segments.map((segment) => {
        const previous = cachedByKey.get(segment.key);
        return previous ? mergeTurnSegmentMonotonic(previous, segment) : segment;
      });
      relocateInterruptPhaseBetweenAdjacentToolGroups(reconciled);
      mergeAdjacentOrphanedThinkingAndToolGroups(reconciled);
      pruneDuplicateToolOnlyGroups(reconciled);
      return finalize(reconciled);
    }

    const merged =
      cached.length === 0 ? segments : mergeSegmentsMonotonic(cached, segments);
    return finalize(merged);
  }, [turnStableKey, segments, isLiveStream, finalReplyText]);
}

function ThinkingToolGroupPanel({
  turnStableKey,
  segment,
  segments,
  isLiveStream,
  isConnecting,
  isProcessing,
  isStillExecuting,
  streamingTools,
  hasFinalReply,
  connectingLabelKey,
  enableProcessTypewriter,
}: {
  turnStableKey: string | undefined;
  segment: ThinkingToolGroupSegment;
  segments: ThinkingTurnSegment[];
  isLiveStream: boolean;
  isConnecting: boolean;
  isProcessing: boolean;
  isStillExecuting: boolean;
  streamingTools: StreamingTool[];
  hasFinalReply: boolean;
  connectingLabelKey: ConnectingLabelKey;
  enableProcessTypewriter: boolean;
}) {
  const { t } = useTranslation('chat');
  const isActive = segment.state === 'active';
  const deferSummaryCollapse = shouldDeferCompletedSummaryCollapse(
    segments,
    segment,
    isLiveStream,
  );
  const showStreamingBody = isActive || deferSummaryCollapse;
  const stableTimeline = useStableThinkingTimeline(
    turnStableKey,
    segment.key,
    segment.timeline,
    isLiveStream,
  );
  const [expanded, setExpanded] = useState(false);
  const [collapseAnimationEnabled, setCollapseAnimationEnabled] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setCollapseAnimationEnabled(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const handleSummaryToggle = () => {
    setExpanded((prev) => !prev);
  };

  const summaryLabel = useMemo(
    () => buildThinkingGroupSummaryLabel(segment.timeline, t),
    [segment.timeline, t],
  );

  if (showStreamingBody) {
    return (
      <TimelineBody
        timeline={stableTimeline}
        isLiveStream={isLiveStream}
        hasFinalReply={hasFinalReply}
        batchIsCompleted={!isActive}
        streamingTools={streamingTools}
        enableProcessTypewriter={enableProcessTypewriter}
        isConnecting={isConnecting}
        isProcessing={isProcessing}
        isStillExecuting={isStillExecuting}
        connectingLabelKey={connectingLabelKey}
      />
    );
  }

  if (!summaryLabel) return null;

  return (
    <div className="w-full">
      <button
        type="button"
        className={chatThinkingSegmentSummaryHeaderClass}
        onClick={handleSummaryToggle}
        aria-expanded={expanded}
      >
        <span className="truncate">{summaryLabel}</span>
        <ChevronDown
          className={thinkingPanelChevronClass(expanded, collapseAnimationEnabled)}
          aria-hidden
        />
      </button>
      <div className={thinkingPanelBodyGridClass(expanded, collapseAnimationEnabled)}>
        <div className="min-h-0 overflow-hidden">
          <TimelineBody
            timeline={stableTimeline}
            isLiveStream={false}
            hasFinalReply={false}
            batchIsCompleted
            streamingTools={streamingTools}
            enableProcessTypewriter={false}
            isConnecting={false}
            isProcessing={false}
            isStillExecuting={false}
            connectingLabelKey={connectingLabelKey}
            readonlyExpanded
          />
        </div>
      </div>
    </div>
  );
}

export interface ThinkingTurnProcessProps {
  /** 与 buildChatDisplayItems turn key 对齐，流式→完成 remount 时保留 timeline */
  turnStableKey?: string;
  segments: ThinkingTurnSegment[];
  isStreaming?: boolean;
  isConnecting?: boolean;
  isProcessing?: boolean;
  isStillExecuting?: boolean;
  streamingTools?: StreamingTool[];
  hasFinalReply?: boolean;
  /** 气泡侧正文；用于 sticky 缓存后去掉与正文重复的 phase-text */
  finalReplyText?: string | null;
  connectingLabelKey?: ConnectingLabelKey;
  /** 统一过程 loading 状态（§4.3 TurnProcessStatus） */
  processStatus?: TurnProcessStatus;
  className?: string;
}

/** 分段思考过程：phase text 与 tool-group 交替。使用位置：AssistantTurnMessage。 */
export function ThinkingTurnProcess({
  turnStableKey,
  segments,
  isStreaming = false,
  isConnecting = false,
  isProcessing = false,
  isStillExecuting = false,
  streamingTools = [],
  hasFinalReply = false,
  finalReplyText = null,
  connectingLabelKey = 'understandingQuestion',
  processStatus = 'idle',
  className,
}: ThinkingTurnProcessProps) {
  const { t } = useTranslation('chat');
  const wasLiveStreamRef = useRef(false);
  const typewriterLockedRef = useRef(false);
  const [enableProcessTypewriter, setEnableProcessTypewriter] = useState(false);

  const isLiveStream =
    isStreaming || isConnecting || isProcessing || isStillExecuting;

  const displaySegments = useStableThinkingSegments(
    turnStableKey,
    segments,
    isLiveStream,
    finalReplyText,
  );

  const activeGroupTimelineLength = useMemo(() => {
    const active = displaySegments.find(
      (segment): segment is ThinkingToolGroupSegment =>
        segment.kind === 'tool-group' && segment.state === 'active',
    );
    return active?.timeline.length ?? 0;
  }, [displaySegments]);

  useEffect(() => {
    if (hasFinalReply) {
      typewriterLockedRef.current = true;
      setEnableProcessTypewriter(false);
    }
  }, [hasFinalReply]);

  useEffect(() => {
    if (activeGroupTimelineLength > 1) {
      typewriterLockedRef.current = true;
      setEnableProcessTypewriter(false);
    }
  }, [activeGroupTimelineLength]);

  useEffect(() => {
    const justWentLive = isLiveStream && !wasLiveStreamRef.current;
    wasLiveStreamRef.current = isLiveStream;

    if (!isLiveStream) {
      setEnableProcessTypewriter(false);
      return;
    }

    if (typewriterLockedRef.current) {
      setEnableProcessTypewriter(false);
      return;
    }

    if (justWentLive && activeGroupTimelineLength === 0) {
      setEnableProcessTypewriter(true);
    }
  }, [isLiveStream, activeGroupTimelineLength]);

  const hasContent =
    displaySegments.length > 0
    || isConnecting
    || isProcessing
    || isStillExecuting
    || streamingTools.length > 0;

  if (!hasContent && !isStreaming) return null;

  const lastSegmentIndex = segments.length - 1;
  const statusLabelKey = resolveProcessStatusLabelKey(processStatus, connectingLabelKey);
  const showStatusLoading = isLiveStream && shouldShowProcessStatusLoading(processStatus);

  return (
    <div className={cn(thinkingPanelRootClass, thinkingProcessSegmentStackClass, className)}>
      {displaySegments.map((segment, index) => {
        if (segment.kind === 'phase-text') {
          if (segment.key === INTERRUPTED_PHASE_TEXT_KEY) {
            return (
              <p
                key={segment.key}
                className="text-sm leading-5 text-muted-foreground"
              >
                {t('streaming.interrupted')}
              </p>
            );
          }
          // 气泡已展示同一段正文时，思考区不再重复渲染（防 sticky 残留）
          if (
            finalReplyText?.trim()
            && classifyTextOverlap(segment.text, finalReplyText) === 'same'
          ) {
            return null;
          }
          const isStreamingPhaseText = isLiveStream && index === lastSegmentIndex;
          return (
            <PhaseTextBlock
              key={segment.key}
              text={segment.text}
              isStreaming={isStreamingPhaseText}
            />
          );
        }

        return (
          <ThinkingToolGroupPanel
            key={segment.key}
            turnStableKey={turnStableKey}
            segment={segment}
            segments={displaySegments}
            isLiveStream={isLiveStream}
            isConnecting={isConnecting}
            isProcessing={isProcessing}
            isStillExecuting={isStillExecuting}
            streamingTools={streamingTools}
            hasFinalReply={hasFinalReply}
            connectingLabelKey={connectingLabelKey}
            enableProcessTypewriter={enableProcessTypewriter}
          />
        );
      })}

      {showStatusLoading && statusLabelKey ? (
        <ChatProcessLoadingIndicator label={t(statusLabelKey)} />
      ) : null}
    </div>
  );
}
