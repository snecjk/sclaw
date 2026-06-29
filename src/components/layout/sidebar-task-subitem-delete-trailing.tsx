/**
 * SidebarTaskSubitemDeleteTrailing — 任务二/三级子项右侧删除槽。
 *
 * 与「最近」行对齐：`pr-12` 预留 + `right-[10px] w-12` 固定槽位，避免贴边被 scroll 区裁切。
 */
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export interface SidebarTaskSubitemDeleteTrailingProps {
  /** 点击删除 */
  onDelete: () => void;
  /** 行是否选中（hover 时操作区底色与行态一致） */
  isActive?: boolean;
  className?: string;
}

/** 与 SidebarRecentSessionRowTrailing 同槽位：right 10px + 宽 48px */
const SIDEBAR_TASK_SUBITEM_TRAILING_SLOT_CLASS = 'absolute right-[10px] top-1/2 w-12 -translate-y-1/2';

export function SidebarTaskSubitemDeleteTrailing({
  onDelete,
  isActive = false,
  className,
}: SidebarTaskSubitemDeleteTrailingProps) {
  const { t } = useTranslation('common');

  return (
    <div className={cn(SIDEBAR_TASK_SUBITEM_TRAILING_SLOT_CLASS, 'z-[2] flex items-center justify-end', className)}>
      <button
        type="button"
        aria-label={t('actions.delete')}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDelete();
        }}
        className={cn(
          'flex items-center justify-center rounded p-0.5 transition-opacity',
          'opacity-0 group-hover:opacity-100',
          isActive
            ? 'bg-[var(--sto-sidebar-subitem-active-bg)] group-hover:bg-[var(--sto-sidebar-row-hover-bg)]'
            : 'bg-[var(--sto-sidebar-bg)] group-hover:bg-[var(--sto-sidebar-row-hover-bg)]',
          'text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
        )}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}

/** 子项主行右侧内距，与 trailing 槽位对齐 */
export const SIDEBAR_TASK_SUBITEM_ROW_PR_CLASS = 'pr-12';
