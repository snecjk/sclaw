import { BellOff, Pin } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { ImAvatar } from './im-avatar';
import { DingTalkFolderIcon, DingTalkUserAddIcon } from './icons/dingtalk-toolbar-icons';
import { messagesConversationInsetClass } from './messages-conversation-inset';
import {
  messagesSubheaderBorderClass,
  messagesSubheaderHeightClass,
} from '../lib/messages-subheader-metrics';
import { SearchLogOutlinedIcon } from './icons/search-log-outlined';
import type { IMConversation } from '../types';

/** 钉钉顶栏图标：22px 细线描边 */
const TOOLBAR_ICON_CLASS = 'h-[22px] w-[22px]';
const TOOLBAR_ICON_COLOR = 'text-[#86909C] dark:text-[#A6A6A6]';

function StatusDot({ status }: { status?: IMConversation['status'] }) {
  if (!status) return null;
  const color =
    status === 'online'
      ? 'bg-emerald-500'
      : status === 'busy'
        ? 'bg-amber-500'
        : 'bg-muted-foreground/50';
  return <span className={cn('h-2 w-2 rounded-full', color)} aria-hidden />;
}

function ToolbarIconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
        TOOLBAR_ICON_COLOR,
        'transition-colors hover:bg-black/[0.04] hover:text-[#4E5969]',
        'dark:hover:bg-white/[0.06] dark:hover:text-[#C9CDD4]',
      )}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function ConversationToolbar({
  conversation,
  onChatFiles,
  onAddMembers,
  onSearchMessages,
  onTogglePin,
  onToggleMute,
}: {
  conversation: IMConversation;
  onChatFiles: () => void;
  onAddMembers: () => void;
  onSearchMessages: () => void;
  onTogglePin?: () => void;
  onToggleMute?: () => void;
}) {
  const { t } = useTranslation('common');

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-between gap-4 bg-[var(--sto-main-card-bg)]',
        messagesSubheaderHeightClass,
        messagesSubheaderBorderClass,
        messagesConversationInsetClass,
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <ImAvatar kind={conversation.type} label={conversation.avatarLabel} size="sm" />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <h2 className="shrink-0 text-[14px] font-semibold leading-5 text-[var(--sto-text-primary)]">
              {conversation.name}
            </h2>
            <StatusDot status={conversation.status} />
            {conversation.groupTag ? (
              <span className="shrink-0 rounded border border-[#91CAFF] bg-[#E8F3FF] px-1.5 py-0.5 text-[11px] leading-none text-[#1677FF]">
                {conversation.groupTag}
              </span>
            ) : null}
            {conversation.type === 'digital_employee' ? (
              <span className="shrink-0 rounded border border-[#D3ADF7] bg-[#F9F0FF] px-1.5 py-0.5 text-[11px] leading-none text-[#722ED1]">
                {t('im.digitalEmployeeTag')}
              </span>
            ) : null}
            {conversation.statusText ? (
              <span className="min-w-0 truncate text-[12px] leading-4 text-[var(--sto-text-tertiary)]">
                {conversation.statusText}
              </span>
            ) : null}
          </div>
          {conversation.orgPath ? (
            <p className="truncate text-[12px] leading-4 text-[var(--sto-text-tertiary)]">
              {conversation.orgPath}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-4">
        {onTogglePin ? (
          <ToolbarIconButton
            label={conversation.pinned ? t('im.unpinConversation') : t('im.pinConversation')}
            onClick={onTogglePin}
          >
            <Pin className={cn(TOOLBAR_ICON_CLASS, conversation.pinned && 'text-primary')} />
          </ToolbarIconButton>
        ) : null}
        {onToggleMute ? (
          <ToolbarIconButton
            label={conversation.muted ? t('im.unmuteConversation') : t('im.muteConversation')}
            onClick={onToggleMute}
          >
            <BellOff className={cn(TOOLBAR_ICON_CLASS, conversation.muted && 'text-primary')} />
          </ToolbarIconButton>
        ) : null}
        <ToolbarIconButton label={t('im.chatFiles')} onClick={onChatFiles}>
          <DingTalkFolderIcon className={TOOLBAR_ICON_CLASS} />
        </ToolbarIconButton>
        <ToolbarIconButton label={t('im.addGroupMembers')} onClick={onAddMembers}>
          <DingTalkUserAddIcon className={TOOLBAR_ICON_CLASS} />
        </ToolbarIconButton>
        <ToolbarIconButton label={t('im.searchChatContent')} onClick={onSearchMessages}>
          <SearchLogOutlinedIcon className={TOOLBAR_ICON_CLASS} />
        </ToolbarIconButton>
      </div>
    </div>
  );
}
