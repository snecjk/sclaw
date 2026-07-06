import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { ChatProcessLoadingInlineIndicator } from '@/components/chat/chat-process-loading-indicator';

/**
 * PhaseTextBlock - 阶段短 text（摘要之间的正文段落，不是最终交付正文）
 *
 * 使用位置：ThinkingTurnProcess、TimelineBody（narration 折进 timeline 时）
 */
export interface PhaseTextBlockProps {
  /** 阶段叙述正文（用户可见，正常 foreground 色） */
  text: string;
  /** 流式中最后一段 phase-text 时为 true */
  isStreaming?: boolean;
  className?: string;
}

export function PhaseTextBlock({
  text,
  isStreaming = false,
  className,
}: PhaseTextBlockProps) {
  const { t } = useTranslation('chat');

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
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      )}
      {isStreaming ? (
        <ChatProcessLoadingInlineIndicator
          label={t('streaming.processingTitle')}
          className="mt-3"
        />
      ) : null}
    </div>
  );
}
