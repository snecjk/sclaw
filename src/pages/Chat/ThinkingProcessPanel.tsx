import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, ChevronRight, Loader2, MessageCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { ChatToolCallCard } from '@/components/chat/chat-tool-call-card';
import { useSkillsStore } from '@/stores/skills';
import { type ThinkingTimelineItem } from './message-utils';

/** 思考条目正文区最大高度 ≈ 4 行（02-styles 代码块折叠规范，text-sm leading-5） */
const THINKING_ENTRY_MAX_HEIGHT_CLASS = 'max-h-20';

/** 无外层卡片：思考过程直接铺在对话区底色上（设计稿 flat 布局） */
const thinkingPanelRootClass = 'w-full text-[13px] leading-[18px]';

type StreamingTool = {
  id?: string;
  toolCallId?: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  summary?: string;
};

/**
 * 流式脉冲点（与 ChatMessage.StreamingPulse 参数一致，02-styles §流式脉冲）
 * 独立副本：避免 ThinkingProcessPanel ↔ ChatMessage 循环依赖。
 */
function StreamingPulse() {
  return (
    <div className="relative flex h-2.5 w-2.5 shrink-0 items-center justify-center">
      <motion.span
        className="absolute h-2.5 w-2.5 rounded-full bg-primary/25"
        animate={{ scale: [0.8, 1.8], opacity: [0.45, 0] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }}
      />
      <motion.span
        className="relative h-1.5 w-1.5 rounded-full bg-primary"
        animate={{ scale: [0.92, 1.15, 0.92] }}
        transition={{ duration: 0.8, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}

export type ConnectingLabelKey = 'connectingModel' | 'understandingQuestion' | 'stillExecuting';

export interface ConnectingModelIndicatorProps {
  className?: string;
  /** 普通对话默认 understandingQuestion；创建工作流场景传 connectingModel（B1，§2） */
  labelKey?: ConnectingLabelKey;
}

/**
 * 连接/理解等待指示：脉冲点 + 灰字（A1/B1，MasterGo → 02-styles text-muted-foreground text-sm）
 */
export function ConnectingModelIndicator({
  className,
  labelKey = 'understandingQuestion',
}: ConnectingModelIndicatorProps) {
  const { t } = useTranslation('chat');

  return (
    <div
      className={cn('flex items-center gap-2 text-sm text-muted-foreground', className)}
      role="status"
      aria-live="polite"
    >
      <StreamingPulse />
      <span>{t(`streaming.${labelKey}`)}</span>
    </div>
  );
}

/**
 * B3 等待用户填写/提交参数表单：脉冲点 + awaitingReply 文案（持续到提交，仅视觉）
 */
export function AwaitingReplyIndicator({ className }: { className?: string }) {
  const { t } = useTranslation('chat');

  return (
    <div
      className={cn('flex items-center gap-2 text-sm text-muted-foreground', className)}
      role="status"
      aria-live="polite"
    >
      <StreamingPulse />
      <span>{t('streaming.awaitingReply')}</span>
    </div>
  );
}

interface ThinkingProcessPanelProps {
  timeline: ThinkingTimelineItem[];
  isStreaming?: boolean;
  isConnecting?: boolean;
  isProcessing?: boolean;
  isStillExecuting?: boolean;
  streamingTools?: StreamingTool[];
  /** @see ConnectingModelIndicatorProps.labelKey */
  connectingLabelKey?: ConnectingLabelKey;
  className?: string;
}

function toolRowKey(tool: Extract<ThinkingTimelineItem, { type: 'tool' }>): string {
  return tool.id || `tool-${tool.index}`;
}

function streamingToolKey(tool: StreamingTool): string {
  return tool.toolCallId || tool.id || tool.name;
}

function buildCollapsedSummary(
  timeline: ThinkingTimelineItem[],
  t: (key: string, opts?: Record<string, unknown>) => string,
): string | null {
  const toolCount = timeline.filter((item) => item.type === 'tool').length;
  const thoughtCount = timeline.filter((item) => item.type === 'thinking').length;
  if (toolCount === 0 && thoughtCount === 0) return null;
  return t('streaming.collapsedSummary', { thoughtCount, toolCount });
}

function resolveSkillDisplayName(name: string, skills: { id: string; slug?: string; name: string; title?: string }[]): string {
  if (!name) return name;
  const skill = skills.find(
    (s) => s.id === name || s.slug === name || s.id.toLowerCase() === name.toLowerCase() || s.slug?.toLowerCase() === name.toLowerCase(),
  );
  return skill?.title || skill?.name || name;
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

export function ThinkingProcessPanel({
  timeline,
  isStreaming = false,
  isConnecting = false,
  isProcessing = false,
  isStillExecuting = false,
  streamingTools = [],
  connectingLabelKey = 'understandingQuestion',
  className,
}: ThinkingProcessPanelProps) {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(isStreaming);
  const skills = useSkillsStore((state) => state.skills);
  const fetchSkills = useSkillsStore((state) => state.fetchSkills);

  useEffect(() => {
    if (isStreaming || isConnecting || isProcessing || isStillExecuting) {
      setExpanded(true);
      return;
    }
    if (timeline.length > 0) {
      setExpanded(false);
    }
  }, [isStreaming, isConnecting, isProcessing, isStillExecuting, timeline.length]);

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
  const collapsedSummary = useMemo(
    () => buildCollapsedSummary(mergedTimeline, t),
    [mergedTimeline, t],
  );

  const hasPanelBody =
    mergedTimeline.length > 0 || isConnecting || isProcessing || isStillExecuting || !!runningTool;

  const headerLabel = collapsedSummary ?? t('streaming.thinkingProcessTitle');

  if (!hasPanelBody && !isStreaming) return null;

  return (
    <div className={cn(thinkingPanelRootClass, className)}>
      <button
        type="button"
        className={cn(
          'flex w-full items-center gap-1.5 py-1 text-muted-foreground transition-colors duration-150 hover:text-foreground',
        )}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="truncate font-normal">{headerLabel}</span>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
        )}
      </button>

      {expanded && (
        <div className="space-y-3 pb-1 pt-1">
          {mergedTimeline.map((item, i) => {
            if (item.type === 'thinking') {
              const thinkingContent = resolveSkillNamesInThinking(item.content, skills);
              return (
                <div key={`thinking-${i}`} className="border-l-2 border-border pl-3">
                  <div className="mb-1.5 flex items-center gap-1.5 text-muted-foreground">
                    <MessageCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="font-medium">{t('streaming.deepThinkingLabel')}</span>
                  </div>
                  <div
                    className={cn(
                      THINKING_ENTRY_MAX_HEIGHT_CLASS,
                      'overflow-y-auto prose prose-sm max-w-none text-sm leading-5 text-foreground dark:prose-invert',
                    )}
                  >
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{thinkingContent}</ReactMarkdown>
                  </div>
                </div>
              );
            }

            const key = toolRowKey(item);
            return (
              <ChatToolCallCard
                key={key}
                name={resolveSkillDisplayName(item.name, skills)}
                input={item.input}
                status={streamingStatusByKey.get(key)}
              />
            );
          })}

          {isStillExecuting && !isConnecting && !runningTool ? (
            <ConnectingModelIndicator labelKey="stillExecuting" />
          ) : null}

          {isConnecting ? <ConnectingModelIndicator labelKey={connectingLabelKey} /> : null}

          {isProcessing && !isConnecting ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin opacity-70" aria-hidden />
              <span>{t('streaming.processingTitle')}</span>
            </div>
          ) : null}

          {runningTool && !isConnecting ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin opacity-70" aria-hidden />
              <span>
                {t('streaming.generatingWithTool', {
                  tool: runningTool.summary || resolveSkillDisplayName(runningTool.name, skills),
                })}
              </span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
