import { memo } from 'react';
import { Send } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';
import { renderTextWithAtMentions } from '@/lib/at-mention-highlight';
import { cn } from '@/lib/utils';
import {
  formatDingTalkSentTextForChatPreview,
  type DingTalkSentMessagePreview,
} from '../../../shared/dingtalk-sent-display';
import { maskDwsSensitiveIdsForDisplay } from './message-utils';

interface DingTalkSentPreviewProps {
  previews: DingTalkSentMessagePreview[];
  className?: string;
}

export const DingTalkSentPreview = memo(function DingTalkSentPreview({
  previews,
  className,
}: DingTalkSentPreviewProps) {
  const { t } = useTranslation('chat');

  if (previews.length === 0) return null;

  return (
    <div className={cn('w-full space-y-2', className)}>
      {previews.map((preview, index) => {
        const body = maskDwsSensitiveIdsForDisplay(
          formatDingTalkSentTextForChatPreview(preview.text),
        );
        const recipientLabel = maskDwsSensitiveIdsForDisplay(preview.recipientLabel);
        return (
          <div
            key={preview.toolCallId ?? `${preview.recipientLabel}-${index}`}
            className="w-full rounded-xl border border-border/70 bg-background/80 px-3 py-2.5 shadow-sm"
          >
            <div className="mb-2 space-y-0.5 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Send className="h-3.5 w-3.5 shrink-0 text-primary/80" aria-hidden />
                <span>
                  {preview.recipientKind === 'group' ? (
                    t('composer.dingtalkSentPreviewTitleGroup', { name: recipientLabel })
                  ) : (
                    <>
                      {t('composer.dingtalkSentPreviewTitle', { name: '' })}
                      {renderTextWithAtMentions(`@${recipientLabel}`)}
                    </>
                  )}
                </span>
              </div>
              {preview.title && preview.title !== '消息' ? (
                <div className="truncate pl-5">
                  {t('composer.dingtalkSentPreviewMessageTitle', {
                    title: maskDwsSensitiveIdsForDisplay(preview.title),
                  })}
                </div>
              ) : null}
            </div>
            <div className="prose prose-sm max-w-none text-sm leading-relaxed text-foreground dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
            </div>
          </div>
        );
      })}
    </div>
  );
});
