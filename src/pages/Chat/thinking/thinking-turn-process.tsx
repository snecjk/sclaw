import { memo, useEffect, useMemo, useRef, useState } from 'react';
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
  mergeTurnSegmentMonotonic,
  readGlobalStableSegments,
  readGlobalStableTimeline,
  resolveLiveProjection,
  writeGlobalStableSegments,
  writeGlobalStableTimeline,
} from '@/pages/Chat/thinking/segment-merge';
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
import { sliceStreamingThinkingTail } from '@/pages/Chat/thinking/streaming-tail-window';
import { foldThinkingTimelineTools, resolveTurnToolCount } from '@/pages/Chat/thinking/fold-turn-tools';
import { useChatStore } from '@/stores/chat';
import { useChatSessionRuntimeView } from '@/stores/chat/runtime-selectors';

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

const ThinkingBlockBody = memo(function ThinkingBlockBody({
  content,
  omittedChars = 0,
  isTypewriterActive,
  isStreamActive = false,
  resetKey,
  onRevealComplete,
}: {
  content: string;
  /** 父级已按流式尾部窗口截断后传入的省略字数（未截断为 0） */
  omittedChars?: number;
  isTypewriterActive: boolean;
  /** 流式当前块：整个流式期间保持纯文本（含顺序打字机已锁定的兜底路径），完成帧才转 ReactMarkdown */
  isStreamActive?: boolean;
  resetKey: string;
  onRevealComplete?: () => void;
}) {
  const { t } = useTranslation('chat');
  const { text: displayed, isAnimating } = useTypewriterReveal(content, isTypewriterActive, {
    resetKey,
  });

  useEffect(() => {
    if (!isTypewriterActive || isAnimating) return;
    if (displayed.length < content.length) return;
    onRevealComplete?.();
  }, [isTypewriterActive, isAnimating, displayed, content.length, onRevealComplete]);

  if (isTypewriterActive || isAnimating || isStreamActive) {
    const source = isTypewriterActive || isAnimating ? displayed : content;
    return (
      <p
        className={cn(chatProcessBlockBodyClass, 'whitespace-pre-wrap')}
        aria-busy={isTypewriterActive || isAnimating || isStreamActive ? true : undefined}
      >
        {omittedChars > 0 ? (
          <span className="mb-1 block opacity-70">
            {t('streaming.omittedEarlierThinkingChars', { count: omittedChars })}
          </span>
        ) : null}
        {source}
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
});

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

export function resolveSkillNamesInThinking(
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

type SkillNameResolveEntry = { id: string; slug?: string; name: string; title?: string };

/** 单块内容缓存上限（LRU），防长会话无限增长；skills 数组按引用隔离，store 更新后旧缓存随 WeakMap 回收 */
const SKILL_NAME_RESOLVE_CACHE_LIMIT = 200;
const skillNameResolveCache = new WeakMap<SkillNameResolveEntry[], Map<string, string>>();

/**
 * resolveSkillNamesInThinking 的按块内容缓存版：冻结块重复渲染时零正则；
 * 正在生长的流式块内容每帧变化，天然 miss，行为与全量解析一致。
 */
export function resolveSkillNamesInThinkingCached(
  text: string,
  skills: SkillNameResolveEntry[],
): string {
  if (!text || skills.length === 0) return text;
  let byText = skillNameResolveCache.get(skills);
  if (!byText) {
    byText = new Map();
    skillNameResolveCache.set(skills, byText);
  }
  const hit = byText.get(text);
  if (hit !== undefined) {
    byText.delete(text);
    byText.set(text, hit);
    return hit;
  }
  const resolved = resolveSkillNamesInThinking(text, skills);
  byText.set(text, resolved);
  if (byText.size > SKILL_NAME_RESOLVE_CACHE_LIMIT) {
    const oldest = byText.keys().next().value;
    if (oldest !== undefined) byText.delete(oldest);
  }
  return resolved;
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

/** 流式 snapshot 每帧新建 input 对象；引用不等时按值比较，已完成工具卡片才不致每帧重渲染 */
function toolInputEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left == null || right == null) return false;
  // 快速路径：长度/类型明显不同直接不等，避免大 input JSON.stringify
  if (typeof left !== typeof right) return false;
  if (typeof left === 'string' || typeof left === 'number' || typeof left === 'boolean') {
    return left === right;
  }
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

interface TimelineThinkingRowProps {
  content: string;
  skills: { id: string; slug?: string; name: string; title?: string }[];
  title: string;
  icon: ReturnType<typeof resolveChatThinkingIcon>;
  collapsible: boolean;
  isComplete: boolean;
  autoExpand: boolean;
  isActive: boolean;
  isTypewriterActive: boolean;
  resetKey: string;
  onRevealComplete: (resetKey: string) => void;
}

/** 单个深度思考块：props 全为基础类型/稳定引用，块内容未变时跳过整棵子树（含 ReactMarkdown） */
const TimelineThinkingRow = memo(function TimelineThinkingRow({
  content,
  skills,
  title,
  icon,
  collapsible,
  isComplete,
  autoExpand,
  isActive,
  isTypewriterActive,
  resetKey,
  onRevealComplete,
}: TimelineThinkingRowProps) {
  // 流式当前块先截尾再脱敏/替换技能名：截尾 O(1)（只取最后 3000 字），
  // 避免 10 万字时每帧对全文跑正则。
  const tailWindow = useMemo(
    () => (isActive ? sliceStreamingThinkingTail(content) : { text: content, omittedChars: 0 }),
    [content, isActive],
  );
  const thinkingContent = useMemo(
    () => maskDwsSensitiveIdsForDisplay(
      resolveSkillNamesInThinkingCached(tailWindow.text, skills),
    ),
    [tailWindow.text, skills],
  );
  return (
    <ChatProcessBlock
      title={title}
      icon={icon}
      collapsible={collapsible}
      isComplete={isComplete}
      autoExpand={autoExpand}
      isActive={isActive}
    >
      <ThinkingBlockBody
        content={thinkingContent}
        omittedChars={tailWindow.omittedChars}
        isTypewriterActive={isTypewriterActive}
        isStreamActive={isActive}
        resetKey={resetKey}
        onRevealComplete={() => onRevealComplete(resetKey)}
      />
    </ChatProcessBlock>
  );
});

interface TimelineToolRowProps {
  name: string;
  input: unknown;
  skills: { id: string; slug?: string; name: string; title?: string }[];
  status: StreamingTool['status'] | undefined;
  collapsible: boolean;
  isComplete: boolean;
  autoExpand: boolean;
  isActive: boolean;
  isInputTypewriterActive: boolean;
  isAwaitingToolInput: boolean;
  resetKey: string;
  onInputRevealComplete: (resetKey: string) => void;
}

/** 单个工具调用块：input 按值比较（流式 snapshot 对象每帧新建），其余 props 均为基础类型/稳定引用 */
const TimelineToolRow = memo(function TimelineToolRow({
  name,
  input,
  skills,
  status,
  collapsible,
  isComplete,
  autoExpand,
  isActive,
  isInputTypewriterActive,
  isAwaitingToolInput,
  resetKey,
  onInputRevealComplete,
}: TimelineToolRowProps) {
  return (
    <ChatToolCallCard
      name={name}
      displayName={resolveSkillDisplayName(name, skills)}
      input={input}
      status={status}
      variant="readonly"
      presentation="thinkingProcess"
      thinkingProcessCollapsible={collapsible}
      isComplete={isComplete}
      autoExpand={autoExpand}
      isActive={isActive}
      isInputTypewriterActive={isInputTypewriterActive}
      typewriterResetKey={resetKey}
      onInputRevealComplete={() => onInputRevealComplete(resetKey)}
      isAwaitingToolInput={isAwaitingToolInput}
    />
  );
}, (prev, next) => (
  prev.name === next.name
  && prev.skills === next.skills
  && prev.status === next.status
  && prev.collapsible === next.collapsible
  && prev.isComplete === next.isComplete
  && prev.autoExpand === next.autoExpand
  && prev.isActive === next.isActive
  && prev.isInputTypewriterActive === next.isInputTypewriterActive
  && prev.isAwaitingToolInput === next.isAwaitingToolInput
  && prev.resetKey === next.resetKey
  && prev.onInputRevealComplete === next.onInputRevealComplete
  && toolInputEqual(prev.input, next.input)
));

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
  const sessionKey = useChatStore((state) => state.currentSessionKey);
  const toolEventCount = useChatSessionRuntimeView(sessionKey).toolEventCount;
  const folded = foldThinkingTimelineTools(timeline);
  const displayTimeline = folded.visible;
  const displayToolCount = resolveTurnToolCount(toolEventCount, folded.totalToolCount);
  const showCollapsedToolSummary =
    folded.hiddenToolCount > 0 || displayToolCount > folded.totalToolCount;

  const streamingStatusByKey = useMemo(() => {
    const map = new Map<string, StreamingTool['status']>();
    for (const tool of streamingTools) {
      map.set(streamingToolKey(tool), tool.status);
    }
    return map;
  }, [streamingTools]);

  const { markBlockRevealFinished, getBlockRevealState, sequentialIndex } = useSequentialTypewriterQueue(
    displayTimeline,
    enableProcessTypewriter,
  );

  const level2Collapsible = isLiveStream && !readonlyExpanded;

  return (
    <div className={cn(isLiveStream ? 'space-y-3' : 'space-y-3 pb-1 pt-1')}>
      {showCollapsedToolSummary ? (
        <p className="text-sm leading-5 text-muted-foreground">
          {t('streaming.collapsedSummaryToolsOnly', { toolCount: displayToolCount })}
        </p>
      ) : null}
      {displayTimeline.map((item, i) => {
        const blockResetKey = timelineBlockResetKey(item, i);
        const reveal = getBlockRevealState(i, blockResetKey);
        if (!reveal.isVisible) return null;

        const collapse = resolveTimelineBlockCollapseState(
          i,
          displayTimeline.length,
          isLiveStream,
          batchIsCompleted,
          sequentialIndex,
        );

        if (item.type === 'thinking') {
          return (
            <TimelineThinkingRow
              key={blockResetKey}
              content={item.content}
              skills={skills}
              title={t('streaming.deepThinkingLabel')}
              icon={ThinkingIcon}
              collapsible={level2Collapsible}
              isComplete={collapse.isComplete}
              autoExpand={collapse.autoExpand}
              isActive={collapse.isActive}
              isTypewriterActive={reveal.isTypewriterActive}
              resetKey={blockResetKey}
              onRevealComplete={markBlockRevealFinished}
            />
          );
        }

        if (item.type !== 'tool') return null;

        const key = toolRowKey(item);
        const toolStatus = streamingStatusByKey.get(key);
        return (
          <TimelineToolRow
            key={key}
            name={item.name}
            input={item.input}
            skills={skills}
            status={toolStatus}
            collapsible={level2Collapsible}
            isComplete={collapse.isComplete}
            autoExpand={collapse.autoExpand}
            isActive={collapse.isActive}
            isInputTypewriterActive={reveal.isTypewriterActive && hasDisplayableToolInput(item.input)}
            isAwaitingToolInput={
              reveal.isTypewriterActive && !hasDisplayableToolInput(item.input) && toolStatus === 'running'
            }
            resetKey={blockResetKey}
            onInputRevealComplete={markBlockRevealFinished}
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

    // Live parse output is the canonical view. A parser rebundle can legitimately
    // contain fewer rows while carrying newer tool input; using cached length as
    // an authority here freezes the UI on the older, longer timeline. Keep the
    // cache only as a hand-off fallback for a momentary empty projection.
    const liveProjection = resolveLiveProjection(incoming, cached, isLiveStream);
    if (liveProjection) {
      const next = liveProjection;
      if (next.length > 0) {
        cacheRef.current.set(segmentKey, next);
        writeGlobalStableTimeline(turnStableKey, segmentKey, next);
      }
      return next;
    }

    const merged = mergeTimelineMonotonic(cached, incoming);

    if (merged.length >= cached.length) {
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

    // As with the per-group timeline, live segments must follow the newest
    // parser projection even when regrouping reduces the segment count. The
    // cache records that projection for live→done hand-off but never overrides
    // it while the run is active.
    const liveProjection = resolveLiveProjection(segments, cached, isLiveStream);
    if (liveProjection) {
      return finalize(liveProjection);
    }

    // 完成态以解析器 segment 结构为准，仅按 key 单调合并 timeline，避免流式双摘要缓存残留
    const cachedByKey = new Map(cached.map((segment) => [segment.key, segment]));
    const reconciled = segments.map((segment) => {
      const previous = cachedByKey.get(segment.key);
      return previous ? mergeTurnSegmentMonotonic(previous, segment) : segment;
    });
    relocateInterruptPhaseBetweenAdjacentToolGroups(reconciled);
    mergeAdjacentOrphanedThinkingAndToolGroups(reconciled);
    pruneDuplicateToolOnlyGroups(reconciled);
    return finalize(reconciled);
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
  // 完成态卸载：收起时正文不挂载（不再靠 grid-rows-[0fr] 视觉隐藏全量 DOM）；
  // 收起动画（300ms，§5.6）期间保留挂载，动画结束后卸载
  const [bodyMounted, setBodyMounted] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setCollapseAnimationEnabled(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (expanded) {
      setBodyMounted(true);
      return undefined;
    }
    if (!bodyMounted) return undefined;
    const timer = setTimeout(() => setBodyMounted(false), 300);
    return () => clearTimeout(timer);
  }, [expanded, bodyMounted]);

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
      {bodyMounted ? (
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
      ) : null}
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
export const ThinkingTurnProcess = memo(function ThinkingTurnProcess({
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
});
