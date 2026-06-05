import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { ThinkingTimelineItem } from './message-utils';

type StreamingTool = {
  id?: string;
  toolCallId?: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  summary?: string;
};

export function ConnectingModelIndicator({ className }: { className?: string }) {
  const { t } = useTranslation('chat');

  return (
    <p className={cn('text-sm text-muted-foreground', className)} role="status" aria-live="polite">
      {t('streaming.connectingModel')}
    </p>
  );
}

interface ThinkingProcessPanelProps {
  timeline: ThinkingTimelineItem[];
  isStreaming?: boolean;
  isConnecting?: boolean;
  isProcessing?: boolean;
  streamingTools?: StreamingTool[];
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
  const parts: string[] = [];
  if (toolCount > 0) {
    parts.push(t('streaming.toolCallLabel', { index: toolCount }));
  }
  if (thoughtCount > 0) {
    parts.push(t('streaming.processMessageLabel', { count: thoughtCount }));
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function ThinkingProcessPanel({
  timeline,
  isStreaming = false,
  isConnecting = false,
  isProcessing = false,
  streamingTools = [],
  className,
}: ThinkingProcessPanelProps) {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(isStreaming);

  useEffect(() => {
    if (isStreaming || isConnecting || isProcessing) {
      setExpanded(true);
      return;
    }
    if (timeline.length > 0) {
      setExpanded(false);
    }
  }, [isStreaming, isConnecting, isProcessing, timeline.length]);

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
    mergedTimeline.length > 0 || isConnecting || isProcessing || !!runningTool;

  if (!hasPanelBody && !isStreaming) return null;

  return (
    <div className={cn('w-full rounded-lg bg-[var(--canvas-via)] text-sm', className)}>
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-3 py-2.5 text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {!expanded && collapsedSummary ? (
          <>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
            <span className="truncate font-normal">{collapsedSummary}</span>
          </>
        ) : (
          <>
            <span className="font-normal">{t('streaming.thinkingProcessTitle')}</span>
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
            )}
          </>
        )}
      </button>

      {expanded && (
        <div className="space-y-3 px-3 pb-3">
          {mergedTimeline.map((item, i) => {
            if (item.type === 'thinking') {
              return (
                <div
                  key={`thinking-${i}`}
                  className="prose prose-sm max-w-none text-sm leading-relaxed text-foreground dark:prose-invert"
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown>
                </div>
              );
            }

            const key = toolRowKey(item);
            return (
              <ToolCallRow
                key={key}
                index={item.index}
                name={item.name}
                input={item.input}
                status={streamingStatusByKey.get(key)}
              />
            );
          })}

          {isConnecting ? <ConnectingModelIndicator /> : null}

          {isProcessing && !isConnecting ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin opacity-70" aria-hidden />
              <span>{t('streaming.processingTitle')}</span>
            </div>
          ) : null}

          {runningTool && !isConnecting ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin opacity-70" aria-hidden />
              <span>
                {t('streaming.generatingWithTool', {
                  tool: runningTool.summary || runningTool.name,
                })}
              </span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ToolCallRow({
  index,
  name,
  input,
  status,
}: {
  index: number;
  name: string;
  input: unknown;
  status?: StreamingTool['status'];
}) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const isRunning = status === 'running';
  const hasInput = input != null;

  return (
    <div className="space-y-1">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 text-left text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => hasInput && setOpen((v) => !v)}
        aria-expanded={open}
        disabled={!hasInput}
      >
        {hasInput ? (
          open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
          )
        ) : (
          <span className="inline-block h-3.5 w-3.5 shrink-0" aria-hidden />
        )}
        {isRunning && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin opacity-70" aria-hidden />}
        <span>{t('streaming.toolCallLabel', { index })}</span>
        {name ? <span className="truncate text-xs opacity-60">{name}</span> : null}
      </button>
      {open && hasInput ? (
        <pre className="overflow-x-auto rounded-md bg-background/60 px-2 py-2 text-xs text-muted-foreground">
          {typeof input === 'string' ? input : JSON.stringify(input, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
