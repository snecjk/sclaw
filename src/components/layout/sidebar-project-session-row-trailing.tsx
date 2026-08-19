/**
 * SidebarProjectSessionRowTrailing — 项目内会话行尾。
 * 非 hover：最右侧显示状态（运行中/失败/未读），无状态时显示置顶钉；
 * hover：用「...」菜单覆盖该槽位。
 */
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import sidebarPinIcon from '@/assets/icons/sidebar-pin.svg';
import sidebarUnpinIcon from '@/assets/icons/sidebar-unpin.svg';
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

export interface SidebarProjectSessionRowTrailingProps {
  sessionKey: string;
  isActive?: boolean;
  isPinned: boolean;
  showUnreadDot?: boolean;
  /** 运行中或失败（与未读互斥；用于决定 idle 槽显示状态还是置顶钉） */
  hasStatusMarker?: boolean;
  /** 项目草稿「新对话」不可重命名/置顶 */
  isDraft?: boolean;
  onPin: () => void;
  onRename: () => void;
  onDelete: () => void;
  className?: string;
}

export function SidebarProjectSessionRowTrailing({
  sessionKey,
  isActive = false,
  isPinned,
  showUnreadDot = false,
  hasStatusMarker = false,
  isDraft = false,
  onPin,
  onRename,
  onDelete,
  className,
}: SidebarProjectSessionRowTrailingProps) {
  const { t } = useTranslation('common');

  return (
    <div
      className={cn(
        sidebarSingleActionTrailingSlotClass,
        'flex items-center justify-end',
        className,
      )}
    >
      <div
        className={cn(
          // 常驻状态与 hover 后的 28px「更多」按钮共用同一中心点，
          // 从而对齐项目行右侧第二列操作图标。
          'pointer-events-none flex h-5 w-full items-center justify-center gap-1',
          'transition-opacity group-hover:opacity-0 group-hover:invisible',
        )}
      >
        {showUnreadDot ? (
          <span
            className={cn(sidebarUnreadDotClass, 'shrink-0')}
            aria-label={t('sidebar.sessionUnread')}
          />
        ) : hasStatusMarker ? (
          <SidebarRecentSessionStatus sessionKey={sessionKey} />
        ) : isPinned ? (
          <img src={sidebarPinIcon} alt="" className="h-4 w-4 shrink-0" aria-hidden />
        ) : null}
      </div>
      <div
        className={cn(
          'absolute inset-y-0 right-0 flex w-7 items-center justify-end',
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
            {!isDraft ? (
              <DropdownMenuItem
                className={sidebarRecentMenuItemClass}
                onClick={(e) => {
                  e.stopPropagation();
                  onPin();
                }}
              >
                <img
                  src={isPinned ? sidebarUnpinIcon : sidebarPinIcon}
                  alt=""
                  className="h-4 w-4 shrink-0"
                  aria-hidden
                />
                {isPinned ? t('sidebar.unpinInProject') : t('sidebar.pinInProject')}
              </DropdownMenuItem>
            ) : null}
            {!isDraft ? (
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
            ) : null}
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
