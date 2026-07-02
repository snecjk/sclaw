import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
import { chatThinkingSummaryHeaderClass } from '@/lib/surfaces';
import {
  timelineBlockResetKey,
  toolRowKey,
  streamingToolKey,
} from '@/lib/thinking-timeline-active';
import { useSkillsStore } from '@/stores/skills';
import { type ThinkingTimelineItem } from './message-utils';

/** 无外层卡片：思考过程直接铺在对话区底色上 */
const thinkingPanelRootClass = 'w-full';

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

type StreamingTool = {
  id?: string;
  toolCallId?: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  summary?: string;
};

export type ConnectingLabelKey = 'connectingModel' | 'understandingQuestion' | 'stillExecuting';

export interface ConnectingModelIndicatorProps {
  className?: string;
  /** 普通对话默认 understandingQuestion；创建工作流场景传 connectingModel（B1，§2） */
  labelKey?: ConnectingLabelKey;
}

/**
 * 连接/理解等待指示：chat-interaction-style-spec §4.6（loading.gif + 文案 shimmer）
 */
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

/**
 * B3 等待用户填写/提交参数表单：脉冲 + awaitingReply 文案（持续到提交，仅视觉）
 */
export function AwaitingReplyIndicator({ className }: { className?: string }) {
  const { t } = useTranslation('chat');

  return (
    <ChatProcessLoadingInlineIndicator
      className={className}
      label={t('streaming.awaitingReply')}
    />
  );
}

interface ThinkingProcessPanelProps {
  timeline: ThinkingTimelineItem[];
  isStreaming?: boolean;
  isConnecting?: boolean;
  isProcessing?: boolean;
  isStillExecuting?: boolean;
  streamingTools?: StreamingTool[];
  /** 正文已有内容（与 isStreaming 等配合：全部输出且思考结束后再自动收起） */
  hasReplyBody?: boolean;
  /** @see ConnectingModelIndicatorProps.labelKey */
  connectingLabelKey?: ConnectingLabelKey;
  className?: string;
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
  /** 当前块打字追平快照后回调，用于顺序队列切到下一块 */
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
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

function buildCollapsedSummary(
  timeline: ThinkingTimelineItem[],
  streamingTools: StreamingTool[],
  isLive: boolean,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string | null {
  let toolCount = timeline.filter((item) => item.type === 'tool').length;
  if (isLive && streamingTools.length > toolCount) {
    toolCount = streamingTools.length;
  }
  const thoughtCount = timeline.filter((item) => item.type === 'thinking').length;
  if (toolCount === 0 && thoughtCount === 0) return null;
  return t('streaming.collapsedSummary', { thoughtCount, toolCount });
}

function resolveSkillDisplayName(name: string, skills: { id: string; slug?: string; name: string; title?: string }[]): string {
  if (!name) return name;
  const skill = skills.find(
    (s) => s.id === name || s.slug === name || s.id.toLowerCase() === name.toLowerCase() || s.slug?.toLowerCase() === name.toLowerCase(),
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

/** 二级思考/工具块折叠态：段结束收起；流式末段展开 + shimmer（对齐 sai-desktop） */
function resolveTimelineBlockCollapseState(
  index: number,
  timelineLength: number,
  isLiveStream: boolean,
  hasReplyBody: boolean,
  sequentialIndex: number | null,
): { isComplete: boolean; autoExpand: boolean; isActive: boolean } {
  const isComplete =
    !isLiveStream || index < timelineLength - 1 || hasReplyBody;
  const autoExpand = isLiveStream && !isComplete;
  const isLastIndex = index === timelineLength - 1;
  const isActive =
    isLiveStream
    && !isComplete
    && (sequentialIndex !== null ? sequentialIndex === index : isLastIndex);

  return { isComplete, autoExpand, isActive };
}

export function ThinkingProcessPanel({
  timeline,
  isStreaming = false,
  isConnecting = false,
  isProcessing = false,
  isStillExecuting = false,
  streamingTools = [],
  hasReplyBody = false,
  connectingLabelKey = 'understandingQuestion',
  className,
}: ThinkingProcessPanelProps) {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(isStreaming);
  /** §5.6 首次渲染不播放折叠动画 */
  const [collapseAnimationEnabled, setCollapseAnimationEnabled] = useState(false);
  const prevShouldAutoCollapseRef = useRef(false);
  const wasLiveStreamRef = useRef(false);
  /** 仅「从空 timeline 开始的实时流」启用打字机；重进/历史已有内容则 instant */
  const [enableProcessTypewriter, setEnableProcessTypewriter] = useState(false);
  const skills = useSkillsStore((state) => state.skills);
  const fetchSkills = useSkillsStore((state) => state.fetchSkills);
  const ThinkingIcon = resolveChatThinkingIcon();

  useEffect(() => {
    const frame = requestAnimationFrame(() => setCollapseAnimationEnabled(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const isLiveStream =
      isStreaming || isConnecting || isProcessing || isStillExecuting;

    if (isLiveStream) {
      prevShouldAutoCollapseRef.current = false;
      setExpanded(true);
      return;
    }

    const shouldAutoCollapse = hasReplyBody;
    const justBecameReadyToCollapse =
      shouldAutoCollapse && !prevShouldAutoCollapseRef.current;
    prevShouldAutoCollapseRef.current = shouldAutoCollapse;

    // 正文已全部输出且思考/流式结束 → 收起「思考 X 次…」；之后用户手动展开不再强制收回
    if (justBecameReadyToCollapse) {
      setExpanded(false);
      return;
    }
    if (timeline.length > 0) {
      setExpanded(false);
    }
  }, [
    hasReplyBody,
    isStreaming,
    isConnecting,
    isProcessing,
    isStillExecuting,
    timeline.length,
  ]);

  useEffect(() => {
    if (skills.length === 0) {
      void fetchSkills();
    }
  }, [skills.length, fetchSkills]);

  const mergedTimeline = useMemo(() => {
    if (streamingTools.length === 0) return timeline;

    const knownKeys = new Set(
      timeline
        .filter((item): item is Extract<ThinkingTimelineItem, { type: 'tool' }> => item.type === 'tool')
        .map(toolRowKey),
    );

    const extras: ThinkingTimelineItem[] = [];
    let nextIndex = timeline.filter((item) => item.type === 'tool').length;

    for (const tool of streamingTools) {
      const key = streamingToolKey(tool);
      if (knownKeys.has(key)) continue;
      nextIndex += 1;
      extras.push({
        type: 'tool',
        index: nextIndex,
        id: key,
        name: tool.name,
        input: undefined,
      });
    }

    return extras.length > 0 ? [...timeline, ...extras] : timeline;
  }, [timeline, streamingTools]);

  const streamingStatusByKey = useMemo(() => {
    const map = new Map<string, StreamingTool['status']>();
    for (const tool of streamingTools) {
      map.set(streamingToolKey(tool), tool.status);
    }
    return map;
  }, [streamingTools]);

  const runningTool = streamingTools.find((tool) => tool.status === 'running');
  const isLiveStream =
    isStreaming || isConnecting || isProcessing || isStillExecuting;

  useEffect(() => {
    const justWentLive = isLiveStream && !wasLiveStreamRef.current;
    wasLiveStreamRef.current = isLiveStream;

    if (!isLiveStream) {
      setEnableProcessTypewriter(false);
      return;
    }

    if (justWentLive) {
      // 重进对话 / 切回会话时 timeline 已落盘 → 视为历史，不再打字
      setEnableProcessTypewriter(mergedTimeline.length === 0);
    }
  }, [isLiveStream, mergedTimeline.length]);

  const { markBlockRevealFinished, getBlockRevealState, sequentialIndex } = useSequentialTypewriterQueue(
    mergedTimeline,
    enableProcessTypewriter,
  );
  const collapsedSummary = useMemo(
    () => buildCollapsedSummary(mergedTimeline, streamingTools, isStreaming, t),
    [mergedTimeline, streamingTools, isStreaming, t],
  );

  const lastTimelineItem = mergedTimeline.at(-1);
  /** 工具已结束、下一段思考尚未到达：展示「正在整理工具结果」 */
  const showOrganizingToolResults =
    !isConnecting &&
    !runningTool &&
    (isProcessing ||
      (isLiveStream &&
        lastTimelineItem?.type === 'tool' &&
        (!enableProcessTypewriter || sequentialIndex === null)));

  const hasPanelBody =
    mergedTimeline.length > 0 ||
    isConnecting ||
    showOrganizingToolResults ||
    isStillExecuting ||
    !!runningTool;

  const headerLabel = collapsedSummary ?? t('streaming.thinkingProcessTitle');

  if (!hasPanelBody && !isStreaming) return null;

  return (
    <div className={cn(thinkingPanelRootClass, className)}>
      <button
        type="button"
        className={chatThinkingSummaryHeaderClass}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="truncate">{headerLabel}</span>
        <ChevronDown
          className={thinkingPanelChevronClass(expanded, collapseAnimationEnabled)}
          aria-hidden
        />
      </button>

      <div className={thinkingPanelBodyGridClass(expanded, collapseAnimationEnabled)}>
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-3 pb-1 pt-1">
            {mergedTimeline.map((item, i) => {
            const blockResetKey = timelineBlockResetKey(item, i);
            const reveal = getBlockRevealState(i, blockResetKey);
            if (!reveal.isVisible) return null;

            if (item.type === 'thinking') {
              const thinkingContent = resolveSkillNamesInThinking(item.content, skills);
              const collapse = resolveTimelineBlockCollapseState(
                i,
                mergedTimeline.length,
                isLiveStream,
                hasReplyBody,
                sequentialIndex,
              );
              return (
                <ChatProcessBlock
                  key={blockResetKey}
                  title={t('streaming.deepThinkingLabel')}
                  icon={ThinkingIcon}
                  collapsible={isLiveStream}
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

            const key = toolRowKey(item);
            const toolStatus = streamingStatusByKey.get(key);
            const collapse = resolveTimelineBlockCollapseState(
              i,
              mergedTimeline.length,
              isLiveStream,
              hasReplyBody,
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
                thinkingProcessCollapsible={isLiveStream}
                isComplete={collapse.isComplete}
                autoExpand={collapse.autoExpand}
                isActive={collapse.isActive}
                isInputTypewriterActive={reveal.isTypewriterActive && item.input != null}
                typewriterResetKey={blockResetKey}
                onInputRevealComplete={() => markBlockRevealFinished(blockResetKey)}
                isAwaitingToolInput={
                  reveal.isTypewriterActive && item.input == null && toolStatus === 'running'
                }
              />
            );
          })}

          {isConnecting ? (
            <ChatProcessLoadingIndicator label={t(`streaming.${connectingLabelKey}`)} />
          ) : null}

          {showOrganizingToolResults ? (
            <ChatProcessLoadingIndicator label={t('streaming.processingTitle')} />
          ) : null}

          {isStillExecuting && !isConnecting && !runningTool && !showOrganizingToolResults ? (
            <ChatProcessLoadingIndicator label={t('streaming.stillExecuting')} />
          ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
