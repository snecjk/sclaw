import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import { chatRemarkPlugins } from '@/lib/remark-gfm-chat';
import { cn } from '@/lib/utils';

/**
 * PhaseTextBlock - 阶段短 text（摘要之间的正文段落，不是最终交付正文）
 *
 * 使用位置：ThinkingTurnProcess、TimelineBody（narration 折进 timeline 时）
 * loading 文案由父级 TurnProcessStatus 统一渲染，本组件不展示过程 loading。
 */
export interface PhaseTextBlockProps {
  /** 阶段叙述正文（用户可见，正常 foreground 色） */
  text: string;
  /** 流式中最后一段 phase-text 时为 true（仅影响排版，不渲染 loading） */
  isStreaming?: boolean;
  className?: string;
}

export const PhaseTextBlock = memo(function PhaseTextBlock({
  text,
  isStreaming = false,
  className,
}: PhaseTextBlockProps) {
  return (
    <div
      className={cn(
        'max-w-none text-foreground',
        !isStreaming && 'prose prose-sm dark:prose-invert [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
        className,
      )}
      aria-busy={isStreaming ? true : undefined}
    >
      {isStreaming ? (
        <p className="m-0 whitespace-pre-wrap text-sm leading-5 text-foreground">{text}</p>
      ) : (
        <ReactMarkdown remarkPlugins={chatRemarkPlugins}>{text}</ReactMarkdown>
      )}
    </div>
  );
});
