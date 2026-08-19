/**
 * SidebarRecentSessionRow — 侧边栏最近会话单行（含 inline 重命名 + 行尾菜单）。
 *
 * 布局：标题纯文字；行尾最右侧非 hover 显示状态（或置顶钉），hover 用「...」覆盖。
 */
import { useTranslation } from 'react-i18next';
import { SidebarChannelSourceBadge } from '@/components/layout/sidebar-channel-source-badge';
import { SidebarRecentSessionRowTrailing } from '@/components/layout/sidebar-recent-session-row-trailing';
import { cn } from '@/lib/utils';
import {
  sidebarListItemTextClass,
  sidebarRecentSessionActiveClass,
  sidebarSingleActionRowPaddingClass,
  sidebarSubitemTextIdleClass,
} from '@/lib/surfaces';
import type { SidebarChannelSource } from '@/lib/session-channel-source';
import type { ChatSession } from '@/stores/chat/types';
import { useChatStore } from '@/stores/chat';
import { readSessionUnread, useSessionUnreadStore } from '@/stores/session-unread';
import { handleSidebarSessionDoubleClick } from '@/lib/sidebar-project-session-navigation';
import { useChatSessionRuntimeView } from '@/stores/chat/runtime-selectors';

export interface SidebarRecentSessionRowProps {
  session: ChatSession;
  label: string;
  isActive: boolean;
  isPinned: boolean;
  channelSource?: SidebarChannelSource | null;
  isEditing: boolean;
  editingValue: string;
  onOpen: () => void;
  onPin: () => void;
  onStartRename: () => void;
  onEditingValueChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
  className?: string;
}

export function SidebarRecentSessionRow({
  session,
  label,
  isActive,
  isPinned,
  channelSource = null,
  isEditing,
  editingValue,
  onOpen,
  onPin,
  onStartRename,
  onEditingValueChange,
  onCommitRename,
  onCancelRename,
  onDelete,
  className,
}: SidebarRecentSessionRowProps) {
  const { t } = useTranslation('common');
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const runtime = useChatSessionRuntimeView(session.key);
  const unreadKeys = useSessionUnreadStore((s) => s.unreadKeys);
  const isCurrentSession = currentSessionKey === session.key;
  const isRunning = runtime.sending;
  const hasError = Boolean(runtime.error);
  const showUnreadDot = !isCurrentSession
    && !isRunning
    && !hasError
    && readSessionUnread(unreadKeys, session.key);
  const hasStatusMarker = showUnreadDot || isRunning || hasError;

  if (isEditing) {
    return (
      <div className={cn('relative flex w-full min-w-0 items-center', className)}>
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
          className={cn(
            'h-8 w-full rounded-[8px] border border-[var(--sto-brand-6)] bg-card px-[10px] py-[3px] pr-16 text-left text-[13px] leading-5 text-foreground outline-none',
          )}
        />
      </div>
    );
  }

  return (
    <div className={cn('relative flex w-full min-w-0 items-center', className)}>
      <div
        className={cn(
          'group relative flex h-8 w-full items-center rounded-lg transition-colors',
          isActive
            ? cn(sidebarRecentSessionActiveClass, 'hover:bg-[var(--sto-sidebar-row-hover-bg)]')
            : sidebarSubitemTextIdleClass,
        )}
      >
        <button
          type="button"
          onClick={onOpen}
          onDoubleClick={() => handleSidebarSessionDoubleClick(session.key, onStartRename)}
          title={label}
          className={cn(
            'flex h-8 min-w-0 w-full flex-1 items-center overflow-hidden rounded-lg bg-transparent px-[10px] py-1 text-left',
            sidebarSingleActionRowPaddingClass,
            'pr-8',
          )}
        >
          <span className="flex min-w-0 flex-1 items-center gap-0">
            <span className={cn('min-w-0 flex-1 truncate', sidebarListItemTextClass)}>
              {label}
            </span>
            <SidebarChannelSourceBadge source={channelSource} />
          </span>
        </button>
        <SidebarRecentSessionRowTrailing
          sessionKey={session.key}
          isActive={isActive}
          isPinned={isPinned}
          showUnreadDot={showUnreadDot}
          hasStatusMarker={hasStatusMarker}
          onPin={onPin}
          onRename={onStartRename}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}
