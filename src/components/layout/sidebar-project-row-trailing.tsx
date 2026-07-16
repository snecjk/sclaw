/**
 * SidebarProjectRowTrailing — 项目行尾：新建对话 (+) +「...」菜单。
 */
import { Folder, MessageSquarePlus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
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
  sidebarRecentMenuDividerClass,
  sidebarRecentMenuItemClass,
  sidebarTextIconClass,
} from '@/lib/surfaces';

export interface SidebarProjectRowTrailingProps {
  onNewChat: () => void;
  onRename: () => void;
  onOpenFolder: () => void;
  onDelete: () => void;
  className?: string;
}

/** 容纳「新建对话」+「更多」两个 28px 按钮 */
const SIDEBAR_ROW_TRAILING_W_CLASS = 'w-[56px]';

export function SidebarProjectRowTrailing({
  onNewChat,
  onRename,
  onOpenFolder,
  onDelete,
  className,
}: SidebarProjectRowTrailingProps) {
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
          'absolute inset-0 flex items-center justify-end gap-0.5',
          'invisible opacity-0 transition-opacity group-hover:visible group-hover:opacity-100',
          'rounded-md bg-[var(--sto-sidebar-bg)] group-hover:bg-[var(--sto-sidebar-row-hover-bg)]',
        )}
      >
        <button
          type="button"
          aria-label={t('sidebar.newChatInProject')}
          title={t('sidebar.newChatInProject')}
          onClick={(e) => {
            e.stopPropagation();
            onNewChat();
          }}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md',
            sidebarTextIconClass,
            'hover:bg-black/[0.04]',
          )}
        >
          <MessageSquarePlus className="h-4 w-4" aria-hidden />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('sidebar.projectRowMenu')}
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
                onNewChat();
              }}
            >
              <MessageSquarePlus className="h-4 w-4 shrink-0" aria-hidden />
              {t('sidebar.newChatInProject')}
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
              className={sidebarRecentMenuItemClass}
              onClick={(e) => {
                e.stopPropagation();
                onOpenFolder();
              }}
            >
              <Folder className="h-4 w-4 shrink-0" aria-hidden />
              {t('sidebar.openProjectFolder')}
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
