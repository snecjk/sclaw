/**
 * SidebarProjectRowTrailing — 项目行尾：新建对话 (+) +「...」菜单。
 */
import { Folder, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import sidebarProjectNewChatIcon from '@/assets/icons/sidebar-project-new-chat.svg?raw';
import { ThemedMonochromeIcon } from '@/components/icons/themed-monochrome-icon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipArrow, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  sidebarRecentMenuContentClass,
  sidebarRecentMenuDeleteItemClass,
  sidebarRecentMenuDividerClass,
  sidebarRecentMenuItemClass,
  sidebarTextIconClass,
  sidebarTooltipArrowClass as SIDEBAR_TOOLTIP_ARROW_CLASS,
  sidebarTooltipContentClass as SIDEBAR_TOOLTIP_CLASS,
} from '@/lib/surfaces';

export interface SidebarProjectRowTrailingProps {
  onNewChat: () => void;
  onRename: () => void;
  onOpenFolder: () => void;
  onDelete: () => void;
  className?: string;
}

/** 容纳两个 28px 按钮及中间 2px 间距，与分区标题 actions 完全同宽。 */
const SIDEBAR_ROW_TRAILING_W_CLASS = 'w-[58px]';
export function SidebarProjectRowTrailing({
  onNewChat,
  onRename,
  onOpenFolder,
  onDelete,
  className,
}: SidebarProjectRowTrailingProps) {
  const { t } = useTranslation('common');
  const platform = window.electron?.platform;
  const openFolderLabel =
    platform === 'win32'
      ? t('sidebar.openProjectFolderWin')
      : platform === 'linux'
        ? t('sidebar.openProjectFolderLinux')
        : t('sidebar.openProjectFolder');

  return (
    <div
      className={cn(
        // 与分区标题 actions 的 pr-1 对齐，使上下两列 28px 图标共用中心线。
        'absolute right-1 top-1/2 flex -translate-y-1/2 items-center justify-end',
        SIDEBAR_ROW_TRAILING_W_CLASS,
        className,
      )}
    >
      <div
        className={cn(
          'absolute inset-0 flex items-center justify-end gap-0.5',
          'invisible opacity-0 transition-opacity group-hover:visible group-hover:opacity-100',
          'rounded-md bg-transparent',
        )}
      >
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t('sidebar.newChatInProject')}
              onClick={(e) => {
                e.stopPropagation();
                onNewChat();
              }}
              className={cn(
                'order-2 flex h-7 w-7 items-center justify-center rounded-md',
                sidebarTextIconClass,
                'outline-none hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
              )}
            >
              <ThemedMonochromeIcon
                source={sidebarProjectNewChatIcon}
                className="h-[18px] w-[18px]"
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className={SIDEBAR_TOOLTIP_CLASS}>
            {t('sidebar.newChatInProject')}
            <TooltipArrow className={SIDEBAR_TOOLTIP_ARROW_CLASS} />
          </TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('sidebar.projectRowMenu')}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'order-1 flex h-7 w-7 items-center justify-center rounded-md',
                sidebarTextIconClass,
                'outline-none hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
              )}
            >
              <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={sidebarRecentMenuContentClass}>
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
              className={sidebarRecentMenuItemClass}
              onClick={(e) => {
                e.stopPropagation();
                onOpenFolder();
              }}
            >
              <Folder className="h-4 w-4 shrink-0" aria-hidden />
              {openFolderLabel}
            </DropdownMenuItem>
            <div className={sidebarRecentMenuDividerClass} role="separator" />
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
