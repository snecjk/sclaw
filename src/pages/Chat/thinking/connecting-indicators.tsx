import { useTranslation } from 'react-i18next';
import { ChatProcessLoadingInlineIndicator } from '@/components/chat/chat-process-loading-indicator';
import type { ConnectingLabelKey, ConnectingModelIndicatorProps } from '@/pages/Chat/thinking/types-ui';

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

export type { ConnectingLabelKey, ConnectingModelIndicatorProps };
