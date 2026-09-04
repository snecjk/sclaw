/**
 * SidebarRecentGroupRow — 「我的分组 N」标题行：展开/收起 + hover「...」（重命名 / 解散分组）。
 *
 * 重命名在标题原位置 inline 输入；解散仍走 Sidebar 弹窗确认。
 * 使用位置：Sidebar 最近分组区（「最近」标题上方）；分组标题不 sticky，随列表滚动。
 */
import { ChevronDown, ChevronRight, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
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
  sidebarRecentMenuItemClass,
  sidebarSectionChevronClass,
  sidebarSectionLabelClass,
  sidebarUnreadDotClass,
} from '@/lib/surfaces';
import type { SidebarRecentGroup } from '@/stores/sidebar-recent-groups';
import { SidebarTooltip } from '@/components/layout/sidebar-tooltip';

export interface SidebarRecentGroupRowProps {
  /** 分组实体 */
  group: SidebarRecentGroup;
  /** 是否展开 */
  isOpen: boolean;
  /** 收起时组内是否有未读 */
  hasUnread?: boolean;
  /** 是否 inline 重命名中 */
  isEditing: boolean;
  /** 重命名 draft */
  editingValue: string;
  /** 切换展开 */
  onToggle: () => void;
  /** 菜单：重命名 */
  onRename: () => void;
  /** 菜单：解散分组 */
  onDissolve: () => void;
  onEditingValueChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  className?: string;
}

export function SidebarRecentGroupRow({
  group,
  isOpen,
  hasUnread = false,
  isEditing,
  editingValue,
  onToggle,
  onRename,
  onDissolve,
  onEditingValueChange,
  onCommitRename,
  onCancelRename,
  className,
}: SidebarRecentGroupRowProps) {
  const { t } = useTranslation('common');

  if (isEditing) {
    return (
      <div className={cn('relative', className)}>
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
          onClick={(e) => e.stopPropagation()}
          onFocus={(e) => e.currentTarget.select()}
          className={cn(
            'h-[30px] w-full rounded-lg border border-[var(--sto-brand-6)] bg-card px-[10px] py-[5px] text-left outline-none',
            sidebarSectionLabelClass,
          )}
        />
      </div>
    );
  }

  return (
    <div className={cn('group/sto-recent-group-row relative', className)}>
      <SidebarTooltip label={group.name}>
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={onToggle}
        className={cn(
          'flex h-[30px] w-full items-center rounded-lg px-[10px] py-[5px] text-left outline-none ring-offset-2 transition-colors hover:bg-[var(--sto-sidebar-row-hover-bg)] focus-visible:ring-2 focus-visible:ring-ring',
          sidebarSectionLabelClass,
        )}
      >
        <span className="inline-flex min-w-0 max-w-[calc(100%-2rem)] items-center gap-1">
          <span className="min-w-0 truncate">{group.name}</span>
          <span className={sidebarSectionChevronClass} aria-hidden>
            {isOpen ? (
              <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
            )}
          </span>
          {!isOpen && hasUnread ? (
            <span className={sidebarUnreadDotClass} aria-label={t('sidebar.sessionUnread')} />
          ) : null}
        </span>
      </button>
      </SidebarTooltip>
      <div className="pointer-events-none absolute right-[6px] top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/sto-recent-group-row:pointer-events-auto group-hover/sto-recent-group-row:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('sidebar.groupRowMenu')}
              onClick={(e) => e.stopPropagation()}
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--sto-sidebar-text-icon)] hover:bg-black/[0.04]"
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={sidebarRecentMenuContentClass}>
            <DropdownMenuItem className={sidebarRecentMenuItemClass} onClick={onRename}>
              <Pencil className="h-4 w-4 shrink-0" aria-hidden />
              {t('actions.rename')}
            </DropdownMenuItem>
            <DropdownMenuItem className={sidebarRecentMenuItemClass} onClick={onDissolve}>
              <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
              {t('sidebar.dissolveGroup')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
