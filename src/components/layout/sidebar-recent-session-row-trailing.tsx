/**
 * SidebarRecentSessionRowTrailing — 最近会话行尾。
 * 非 hover：最右侧显示状态（运行中/失败/未读），无状态时显示置顶钉；
 * hover：用「...」菜单覆盖该槽位。
 */
import {
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import sidebarPinIcon from '@/assets/icons/sidebar-pin.svg?raw';
import sidebarUnpinIcon from '@/assets/icons/sidebar-unpin.svg?raw';
import { ThemedMonochromeIcon } from '@/components/icons/themed-monochrome-icon';
import { SidebarChannelSourceBadge } from '@/components/layout/sidebar-channel-source-badge';
import type { SidebarChannelSource } from '@/lib/session-channel-source';
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
  sidebarSingleActionTrailingSlotClass,
  sidebarTextIconClass,
  sidebarUnreadDotClass,
} from '@/lib/surfaces';

export interface SidebarRecentSessionRowTrailingProps {
  sessionKey: string;
  isActive?: boolean;
  isPinned: boolean;
  channelSource?: SidebarChannelSource | null;
  showUnreadDot?: boolean;
  /** 运行中或失败（与未读互斥；用于决定 idle 槽显示状态还是置顶钉） */
  hasStatusMarker?: boolean;
  onPin: () => void;
  onRename: () => void;
  onDelete: () => void;
  className?: string;
}

export function SidebarRecentSessionRowTrailing({
  sessionKey,
  isActive = false,
  isPinned,
  channelSource = null,
  showUnreadDot = false,
  hasStatusMarker = false,
  onPin,
  onRename,
  onDelete,
  className,
}: SidebarRecentSessionRowTrailingProps) {
  const { t } = useTranslation('common');
  const showSourceAndPin = Boolean(channelSource && isPinned);

  return (
    <div
      className={cn(
        sidebarSingleActionTrailingSlotClass,
        'right-1 flex items-center justify-center',
        showSourceAndPin && 'w-[58px]',
        className,
      )}
    >
      <div
        className={cn(
          'pointer-events-none grid h-5 w-full items-center justify-items-center',
          showSourceAndPin ? 'grid-cols-[28px_28px] gap-0.5' : 'grid-cols-1',
          'transition-opacity group-hover:opacity-0 group-hover:invisible',
        )}
      >
        {channelSource ? <SidebarChannelSourceBadge source={channelSource} className="ml-0" /> : null}
        {channelSource && isPinned ? (
          <ThemedMonochromeIcon
            source={sidebarPinIcon}
            className="h-4 w-4 text-[var(--sto-sidebar-text-icon)]"
          />
        ) : !channelSource && showUnreadDot ? (
          <span
            className={cn(sidebarUnreadDotClass, 'shrink-0')}
            aria-label={t('sidebar.sessionUnread')}
          />
        ) : !channelSource && hasStatusMarker ? (
          <SidebarRecentSessionStatus sessionKey={sessionKey} />
        ) : !channelSource && isPinned ? (
          <ThemedMonochromeIcon
            source={sidebarPinIcon}
            className="h-4 w-4 text-[var(--sto-sidebar-text-icon)]"
          />
        ) : null}
      </div>
      <div
        className={cn(
          'absolute inset-y-0 right-0 flex w-7 items-center justify-center',
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
              <ThemedMonochromeIcon
                source={isPinned ? sidebarUnpinIcon : sidebarPinIcon}
                className={cn(
                  'h-4 w-4 shrink-0',
                  isPinned
                    ? 'sto-icon--neutral-quiet'
                    : 'sto-icon--neutral',
                )}
              />
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
