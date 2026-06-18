import { memo } from 'react';
import { Send } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { DingTalkMentionTag } from '@/components/dingtalk/DingTalkMentionTag';
import {
  DINGTALK_AGENT_SEND_DISCLAIMER_PLAIN_TEXT,
} from '../../../shared/dingtalk-disclaimer';
import {
  splitDingTalkSentPreviewText,
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
        const { body, disclaimer } = splitDingTalkSentPreviewText(preview.text);
        const maskedBody = maskDwsSensitiveIdsForDisplay(body);
        const recipientLabel = maskDwsSensitiveIdsForDisplay(preview.recipientLabel);
        const footerText = disclaimer || DINGTALK_AGENT_SEND_DISCLAIMER_PLAIN_TEXT;
        return (
          <div
            key={preview.toolCallId ?? `${preview.recipientLabel}-${index}`}
            className="w-full rounded-xl border border-border/70 bg-background/80 px-3 py-2.5 shadow-sm"
          >
            <div className="mb-2 space-y-0.5 text-xs text-muted-foreground">
              <div className="flex flex-wrap items-center gap-1.5">
                <Send className="h-3.5 w-3.5 shrink-0 text-primary/80" aria-hidden />
                <span>
                  {preview.recipientKind === 'group'
                    ? t('composer.dingtalkSentPreviewToGroup')
                    : t('composer.dingtalkSentPreviewTo')}
                </span>
                <DingTalkMentionTag
                  name={recipientLabel}
                  kind={preview.recipientKind === 'group' ? 'group' : 'user'}
                />
              </div>
              {preview.title && preview.title !== '消息' ? (
                <div className="truncate pl-5">
                  {t('composer.dingtalkSentPreviewMessageTitle', {
                    title: maskDwsSensitiveIdsForDisplay(preview.title),
                  })}
                </div>
              ) : null}
            </div>
            {maskedBody ? (
              <div className="prose prose-sm max-w-none text-sm leading-relaxed text-foreground dark:prose-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{maskedBody}</ReactMarkdown>
              </div>
            ) : null}
            <p className="mt-2 border-t border-border/60 pt-2 text-xs leading-relaxed text-[#999999] dark:text-muted-foreground">
              {footerText}
            </p>
          </div>
        );
      })}
    </div>
  );
});
