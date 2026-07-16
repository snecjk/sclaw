/**
 * SidebarRecentSessionRowTrailing — 最近会话行尾：置顶 / 未读 / 运行失败状态 + hover「...」菜单。
 */
import {
  MoreHorizontal,
  Pencil,
  Pin,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarRecentSessionStatus } from '@/components/layout/sidebar-recent-session-status';
import { cn } from '@/lib/utils';
import {
  sidebarRecentMenuContentClass,
  sidebarRecentMenuDeleteItemClass,
  sidebarRecentMenuItemClass,
  sidebarTextIconClass,
  sidebarUnreadDotClass,
} from '@/lib/surfaces';
import { useChatStore } from '@/stores/chat';
import { readSessionUnread, useSessionUnreadStore } from '@/stores/session-unread';

export interface SidebarRecentSessionRowTrailingProps {
  sessionKey: string;
  isActive?: boolean;
  isPinned: boolean;
  onPin: () => void;
  onRename: () => void;
  onDelete: () => void;
  className?: string;
}

const SIDEBAR_RECENT_ROW_TRAILING_W_CLASS = 'w-12';

export function SidebarRecentSessionRowTrailing({
  sessionKey,
  isActive = false,
  isPinned,
  onPin,
  onRename,
  onDelete,
  className,
}: SidebarRecentSessionRowTrailingProps) {
  const { t } = useTranslation('common');
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const runtime = useChatStore((s) => s.runtimeBySessionKey[sessionKey]);
  const currentSessionSending = useChatStore((s) => s.sending);
  const currentSessionActiveRunId = useChatStore((s) => s.activeRunId);
  const currentSessionError = useChatStore((s) => s.error);
  const unreadKeys = useSessionUnreadStore((s) => s.unreadKeys);
  const isCurrentSession = currentSessionKey === sessionKey;
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
    && readSessionUnread(unreadKeys, sessionKey);

  return (
    <div
      className={cn(
        'absolute right-[10px] top-1/2 flex -translate-y-1/2 items-center justify-end',
        SIDEBAR_RECENT_ROW_TRAILING_W_CLASS,
        className,
      )}
    >
      <div
        className={cn(
          'pointer-events-none flex h-5 w-full items-center justify-end gap-1',
          'transition-opacity group-hover:opacity-0 group-hover:invisible',
        )}
      >
        {isPinned ? (
          <Pin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        ) : null}
        {showUnreadDot ? (
          <span
            className={sidebarUnreadDotClass}
            aria-label={t('sidebar.sessionUnread')}
          />
        ) : null}
        <SidebarRecentSessionStatus sessionKey={sessionKey} />
      </div>
      <div
        className={cn(
          'absolute inset-0 flex items-center justify-end',
          'invisible opacity-0 transition-opacity group-hover:visible group-hover:opacity-100',
          'rounded-md',
          isActive
            ? 'bg-[var(--sto-sidebar-subitem-active-bg)] group-hover:bg-[var(--sto-sidebar-row-hover-bg)]'
            : 'bg-[var(--sto-sidebar-bg)] group-hover:bg-[var(--sto-sidebar-row-hover-bg)]',
        )}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('sidebar.sessionRowMenu')}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-md',
                sidebarTextIconClass,
                'hover:bg-black/[0.04]',
              )}
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={sidebarRecentMenuContentClass}>
            <DropdownMenuItem
              className={sidebarRecentMenuItemClass}
              onClick={(e) => {
                e.stopPropagation();
                onPin();
              }}
            >
              <Pin className="h-4 w-4 shrink-0" aria-hidden />
              {isPinned ? t('sidebar.unpinInRecent') : t('sidebar.pinInRecent')}
            </DropdownMenuItem>
            <DropdownMenuItem
              className={sidebarRecentMenuItemClass}
              onClick={(e) => {
                e.stopPropagation();
                onRename();
              }}
            >
              <Pencil className="h-4 w-4 shrink-0" aria-hidden />
              {t('actions.rename')}
            </DropdownMenuItem>
            <DropdownMenuItem
              className={sidebarRecentMenuDeleteItemClass}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
              {t('actions.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
