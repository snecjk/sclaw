/**
 * SidebarRecentSessionRowTrailing — 最近会话行尾：状态位 + hover「...」菜单（重命名 / 分组 / 删除）。
 *
 * 使用位置：SidebarRecentSessionRow
 */
import {
  Check,
  ChevronRight,
  Folder,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarRecentSessionStatus } from '@/components/layout/sidebar-recent-session-status';
import { cn } from '@/lib/utils';
import {
  sidebarRecentMenuContentClass,
  sidebarRecentMenuDeleteItemClass,
  sidebarRecentMenuDividerClass,
  sidebarRecentMenuItemClass,
  sidebarTextIconClass,
} from '@/lib/surfaces';
import type { SidebarRecentGroup } from '@/stores/sidebar-recent-groups';

export interface SidebarRecentSessionRowTrailingProps {
  /** OpenClaw session key */
  sessionKey: string;
  /** 当前会话行是否选中 */
  isActive?: boolean;
  /** 全部分组（子菜单列表） */
  groups: SidebarRecentGroup[];
  /** 当前会话所属 groupId；null = 未分组 */
  currentGroupId: string | null;
  /** 点击重命名 */
  onRename: () => void;
  /** 点击删除 */
  onDelete: () => void;
  /** 子菜单：新建分组 */
  onCreateGroup: () => void;
  /** 子菜单：移入已有分组 */
  onAssignGroup: (groupId: string) => void;
  /** 子菜单：不分组（仅已分组时展示） */
  onUngroup: () => void;
  className?: string;
}

const SIDEBAR_RECENT_ROW_TRAILING_W_CLASS = 'w-12';

export function SidebarRecentSessionRowTrailing({
  sessionKey,
  isActive = false,
  groups,
  currentGroupId,
  onRename,
  onDelete,
  onCreateGroup,
  onAssignGroup,
  onUngroup,
  className,
}: SidebarRecentSessionRowTrailingProps) {
  const { t } = useTranslation('common');

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
          'pointer-events-none flex h-5 w-full items-center justify-end',
          'transition-opacity group-hover:opacity-0 group-hover:invisible',
        )}
      >
        <SidebarRecentSessionStatus sessionKey={sessionKey} />
      </div>
      <div
        className={cn(
          'absolute inset-0 flex items-center justify-end',
          'invisible opacity-0 transition-opacity group-hover:visible group-hover:opacity-100',
          'rounded-md',
          isActive
            ? 'bg-[#DCDCDC] group-hover:bg-[var(--sto-sidebar-row-hover-bg)]'
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
                onRename();
              }}
            >
              <Pencil className="h-4 w-4 shrink-0" aria-hidden />
              {t('actions.rename')}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className={sidebarRecentMenuItemClass}>
                <Folder className="h-4 w-4 shrink-0" aria-hidden />
                <span className="flex-1 truncate">{t('sidebar.group')}</span>
                <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className={sidebarRecentMenuContentClass}>
                {currentGroupId !== null ? (
                  <>
                    <DropdownMenuItem
                      className={sidebarRecentMenuItemClass}
                      onClick={(e) => {
                        e.stopPropagation();
                        onUngroup();
                      }}
                    >
                      {t('sidebar.ungroup')}
                    </DropdownMenuItem>
                    <div className={sidebarRecentMenuDividerClass} role="separator" />
                  </>
                ) : null}
                <DropdownMenuItem
                  className={sidebarRecentMenuItemClass}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreateGroup();
                  }}
                >
                  {t('sidebar.newGroup')}
                </DropdownMenuItem>
                {groups.length > 0 ? (
                  <>
                    <div className={sidebarRecentMenuDividerClass} role="separator" />
                    {groups.map((group) => (
                      <DropdownMenuItem
                        key={group.id}
                        className={sidebarRecentMenuItemClass}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (group.id === currentGroupId) return;
                          onAssignGroup(group.id);
                        }}
                      >
                        <span className="flex min-w-0 flex-1 items-center gap-1 truncate">
                          {group.id === currentGroupId ? (
                            <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                          ) : (
                            <span className="w-3.5 shrink-0" aria-hidden />
                          )}
                          <span className="truncate">{group.name}</span>
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </>
                ) : null}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
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
