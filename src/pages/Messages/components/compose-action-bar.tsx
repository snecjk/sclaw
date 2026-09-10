import {
  Bot,
  Package,
  Paperclip,
  Plus,
  Smile,
  ThumbsUp,
  Type,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ComposeActionIconButton } from './compose-action-icon-button';

const ICON_CLASS = 'h-5 w-5';

/** 输入框内部左侧操作按钮 */
export function ComposeToolbarLeft({
  disabled,
  showAgentAction,
  formatActive,
  onToggleFormat,
  onSendArtifact,
  onAttach,
}: {
  disabled?: boolean;
  showAgentAction?: boolean;
  formatActive?: boolean;
  onToggleFormat?: () => void;
  onSendArtifact: () => void;
  onAttach?: () => void;
}) {
  const { t } = useTranslation('common');

  const mockAction = (label: string) => {
    toast.message(t('im.mockComposeAction', { action: label }));
  };

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">
      <ComposeActionIconButton label={t('im.emoji')} disabled={disabled} onClick={() => mockAction(t('im.emoji'))}>
        <Smile className={ICON_CLASS} strokeWidth={1.25} />
      </ComposeActionIconButton>
      <ComposeActionIconButton label={t('im.thumbsUp')} disabled={disabled} onClick={() => mockAction(t('im.thumbsUp'))}>
        <ThumbsUp className={ICON_CLASS} strokeWidth={1.25} />
      </ComposeActionIconButton>
      <ComposeActionIconButton
        label={t('im.textFormat')}
        disabled={disabled}
        onClick={() => onToggleFormat?.()}
      >
        <Type
          className={cn(
            ICON_CLASS,
            formatActive && 'text-[#FF6A00] dark:text-[#FF8F1F]',
          )}
          strokeWidth={formatActive ? 2 : 1.25}
        />
      </ComposeActionIconButton>
      <ComposeActionIconButton
        label={t('im.attach')}
        disabled={disabled}
        onClick={() => {
          if (onAttach) {
            onAttach();
            return;
          }
          mockAction(t('im.attach'));
        }}
      >
        <Paperclip className={ICON_CLASS} strokeWidth={1.25} />
      </ComposeActionIconButton>
      <ComposeActionIconButton label={t('im.sendArtifact')} disabled={disabled} onClick={onSendArtifact}>
        <Package className={ICON_CLASS} strokeWidth={1.25} />
      </ComposeActionIconButton>
      {showAgentAction ? (
        <ComposeActionIconButton label={t('im.handToAgent')} disabled={disabled} onClick={() => mockAction(t('im.handToAgent'))}>
          <Bot className={ICON_CLASS} strokeWidth={1.25} />
        </ComposeActionIconButton>
      ) : null}
      <ComposeActionIconButton label={t('im.more')} disabled={disabled} onClick={() => mockAction(t('im.more'))}>
        <Plus className={ICON_CLASS} strokeWidth={1.25} />
      </ComposeActionIconButton>
    </div>
  );
}
