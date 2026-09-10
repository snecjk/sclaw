import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { ImAvatar } from './im-avatar';
import type { IMConversation } from '../types';

const conversationActiveItemClass = cn(
  'relative z-[1] rounded-l-[10px] rounded-r-none -mr-[9px]',
  'border-r border-[var(--sto-sidebar-nav-active-bg)]',
  'bg-[var(--sto-sidebar-nav-active-bg)]',
  'hover:bg-[var(--sto-sidebar-nav-active-bg)]',
);

function UnreadBadge({ count, muted }: { count: number; muted?: boolean }) {
  if (count <= 0) return null;
  if (muted) {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--sto-text-tertiary)]" />;
  }
  return (
    <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-destructive px-1.5 py-0.5 text-[12px] font-medium leading-none text-white">
      {count > 99 ? '99+' : count}
    </span>
  );
}

function ConversationSection({
  title,
  conversations,
  activeId,
  onSelect,
  defaultExpanded = true,
}: {
  title: string;
  conversations: IMConversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  defaultExpanded?: boolean;
}) {
  const { t } = useTranslation('common');
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (conversations.length === 0) return null;

  return (
    <div className="px-2 py-1">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--sto-surface-hover)]"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--sto-text-tertiary)]" strokeWidth={2} />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--sto-text-tertiary)]" strokeWidth={2} />
        )}
        <span className="text-[12px] font-medium text-[var(--sto-text-tertiary)]">{title}</span>
      </button>
      {expanded ? (
        <div className="flex flex-col gap-0.5">
          {conversations.map((conversation) => {
            const active = conversation.id === activeId;
            return (
              <button
                key={conversation.id}
                type="button"
                onClick={() => onSelect(conversation.id)}
                className={cn(
                  'flex w-full items-center gap-3 px-2 py-2.5 text-left transition-colors',
                  active
                    ? conversationActiveItemClass
                    : 'rounded-[10px] hover:bg-[var(--sto-surface-hover)]',
                )}
                data-selected={active ? true : undefined}
                aria-selected={active}
              >
                <ImAvatar kind={conversation.type} label={conversation.avatarLabel} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-medium text-[var(--sto-text-primary)]">
                      {conversation.name}
                    </span>
                    {conversation.type === 'digital_employee' ? (
                      <span className="shrink-0 rounded bg-[var(--sto-badge-external-background)] px-1.5 py-0.5 text-[11px] text-[var(--sto-badge-external-foreground)]">
                        {t('im.digitalEmployeeTag')}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 truncate text-[13px] text-[var(--sto-text-tertiary)]">
                    {conversation.lastMessage}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-[12px] text-[var(--sto-text-tertiary)]">{conversation.lastTime}</span>
                  <UnreadBadge count={conversation.unread} muted={conversation.muted} />
                </div>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function ConversationList({
  conversations,
  activeId,
  onSelect,
}: {
  conversations: IMConversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation('common');
  const pinned = conversations.filter((item) => item.pinned);
  const recent = conversations.filter((item) => !item.pinned);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
      <ConversationSection
        title={t('im.pinned')}
        conversations={pinned}
        activeId={activeId}
        onSelect={onSelect}
      />
      <ConversationSection
        title={t('im.recent')}
        conversations={recent}
        activeId={activeId}
        onSelect={onSelect}
      />
    </div>
  );
}
