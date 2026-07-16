/**
 * SidebarProjectSessionRow — 项目树内嵌套会话行。
 *
 * 布局与「最近」对齐：三种状态（未读 / 运行中 / 失败）在标题左侧；置顶钉在行尾。
 */
import { useTranslation } from 'react-i18next';
import { SidebarProjectSessionRowTrailing } from '@/components/layout/sidebar-project-session-row-trailing';
import { SidebarRecentSessionStatus } from '@/components/layout/sidebar-recent-session-status';
import { cn } from '@/lib/utils';
import {
  sidebarListItemTextClass,
  sidebarRecentSessionActiveClass,
  sidebarSubitemTextIdleClass,
  sidebarUnreadDotClass,
} from '@/lib/surfaces';
import type { ChatSession } from '@/stores/chat/types';
import { isProjectNewChatDraftKey } from '@/stores/chat/types';
import { useChatStore } from '@/stores/chat';
import { readSessionUnread, useSessionUnreadStore } from '@/stores/session-unread';

export interface SidebarProjectSessionRowProps {
  session: ChatSession;
  label: string;
  isActive: boolean;
  isPinned: boolean;
  isEditing: boolean;
  editingValue: string;
  onOpen: () => void;
  onPin: () => void;
  onStartRename: () => void;
  onEditingValueChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
}

export function SidebarProjectSessionRow({
  session,
  label,
  isActive,
  isPinned,
  isEditing,
  editingValue,
  onOpen,
  onPin,
  onStartRename,
  onEditingValueChange,
  onCommitRename,
  onCancelRename,
  onDelete,
}: SidebarProjectSessionRowProps) {
  const { t } = useTranslation('common');
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const runtime = useChatStore((s) => s.runtimeBySessionKey[session.key]);
  const currentSessionSending = useChatStore((s) => s.sending);
  const currentSessionActiveRunId = useChatStore((s) => s.activeRunId);
  const currentSessionError = useChatStore((s) => s.error);
  const unreadKeys = useSessionUnreadStore((s) => s.unreadKeys);
  const isCurrentSession = currentSessionKey === session.key;
  const isRunning = Boolean(
    runtime?.sending
    || runtime?.activeRunId
    || (isCurrentSession && (currentSessionSending || currentSessionActiveRunId)),
  );
  const hasError = Boolean(
    (runtime?.error != null && runtime.error !== '')
    || (isCurrentSession && currentSessionError != null && currentSessionError !== ''),
  );
  const showUnreadDot = !isCurrentSession
    && !isRunning
    && !hasError
    && readSessionUnread(unreadKeys, session.key);
  const isDraft = isProjectNewChatDraftKey(session.key);

  if (isEditing) {
    return (
      <div className="relative flex w-full min-w-0 items-center pl-5">
        <input
          type="text"
          autoFocus
          value={editingValue}
          aria-label={t('actions.rename')}
          onChange={(e) => onEditingValueChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommitRename();
            else if (e.key === 'Escape') onCancelRename();
          }}
          onBlur={onCommitRename}
          className="w-full rounded-[8px] border border-[var(--sto-brand-6)] bg-white px-[10px] py-[6px] pr-16 text-left text-sm leading-5 text-foreground outline-none"
        />
      </div>
    );
  }

  return (
    <div className="relative flex w-full min-w-0 items-center pl-5">
      <div
        className={cn(
          'group relative flex h-9 w-full items-center rounded-lg transition-colors',
          isActive
            ? cn(sidebarRecentSessionActiveClass, 'hover:bg-[var(--sto-sidebar-row-hover-bg)]')
            : sidebarSubitemTextIdleClass,
        )}
      >
        <button
          type="button"
          onClick={onOpen}
          title={label}
          className="flex h-9 min-w-0 w-full flex-1 items-center gap-2 overflow-hidden rounded-lg bg-transparent px-[10px] py-2 pr-12 text-left"
        >
          {showUnreadDot ? (
            <span
              className={cn(sidebarUnreadDotClass, 'shrink-0')}
              aria-label={t('sidebar.sessionUnread')}
            />
          ) : (
            <SidebarRecentSessionStatus sessionKey={session.key} />
          )}
          <span className={cn('min-w-0 flex-1 truncate', sidebarListItemTextClass, isActive && 'font-medium')}>
            {label}
          </span>
        </button>
        <SidebarProjectSessionRowTrailing
          isActive={isActive}
          isPinned={isPinned}
          isDraft={isDraft}
          onPin={onPin}
          onRename={onStartRename}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}
