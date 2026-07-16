/**
 * SidebarProjectSessionRowTrailing — 项目内会话行尾：置顶钉 + hover「...」菜单。
 * 三种状态在标题左侧，见 SidebarProjectSessionRow。
 */
import { MoreHorizontal, Pin, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  sidebarRecentMenuContentClass,
  sidebarRecentMenuDeleteItemClass,
  sidebarRecentMenuItemClass,
  sidebarTextIconClass,
} from '@/lib/surfaces';

export interface SidebarProjectSessionRowTrailingProps {
  isActive?: boolean;
  isPinned: boolean;
  /** 项目草稿「新对话」不可重命名/置顶 */
  isDraft?: boolean;
  onPin: () => void;
  onRename: () => void;
  onDelete: () => void;
  className?: string;
}

const SIDEBAR_ROW_TRAILING_W_CLASS = 'w-12';

export function SidebarProjectSessionRowTrailing({
  isActive = false,
  isPinned,
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
        'absolute right-[10px] top-1/2 flex -translate-y-1/2 items-center justify-end',
        SIDEBAR_ROW_TRAILING_W_CLASS,
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
            {!isDraft ? (
              <DropdownMenuItem
                className={sidebarRecentMenuItemClass}
                onClick={(e) => {
                  e.stopPropagation();
                  onPin();
                }}
              >
                <Pin className="h-4 w-4 shrink-0" aria-hidden />
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
