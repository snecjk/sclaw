/**
 * SidebarTaskSubitemDeleteTrailing — 任务二/三级子项右侧槽。
 * 非 hover：最右侧显示状态（运行中/失败/未读）；
 * hover：删除图标覆盖该槽位。
 *
 * 与「最近」行共用 28px、贴右缘的单操作槽位。
 */
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SidebarRecentSessionStatus } from '@/components/layout/sidebar-recent-session-status';
import { cn } from '@/lib/utils';
import {
  sidebarSingleActionRowPaddingClass,
  sidebarSingleActionTrailingSlotClass,
  sidebarUnreadDotClass,
} from '@/lib/surfaces';

export interface SidebarTaskSubitemDeleteTrailingProps {
  /** 点击删除 */
  onDelete: () => void;
  /** 行是否选中（hover 时操作区底色与行态一致） */
  isActive?: boolean;
  /** 关联会话 key；有则可读运行中/失败状态 */
  sessionKey?: string;
  /** 未读红点（与运行中/失败互斥，由调用方保证） */
  showUnreadDot?: boolean;
  className?: string;
}

export function SidebarTaskSubitemDeleteTrailing({
  onDelete,
  isActive = false,
  sessionKey,
  showUnreadDot = false,
  className,
}: SidebarTaskSubitemDeleteTrailingProps) {
  const { t } = useTranslation('common');

  return (
    <div className={cn(sidebarSingleActionTrailingSlotClass, 'right-1 z-[2] flex items-center justify-center', className)}>
      <div
        className={cn(
          'pointer-events-none flex h-5 w-full items-center justify-center',
          'transition-opacity group-hover:opacity-0 group-hover:invisible',
        )}
      >
        {showUnreadDot ? (
          <span
            className={cn(sidebarUnreadDotClass, 'shrink-0')}
            aria-label={t('sidebar.sessionUnread')}
          />
        ) : sessionKey ? (
          <SidebarRecentSessionStatus sessionKey={sessionKey} />
        ) : null}
      </div>
      <div
        className={cn(
          'absolute inset-0 flex items-center justify-center',
          'invisible opacity-0 transition-opacity group-hover:visible group-hover:opacity-100',
        )}
      >
        <button
          type="button"
          aria-label={t('actions.delete')}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete();
          }}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded',
            isActive
              ? 'bg-[var(--sto-sidebar-subitem-active-bg)] group-hover:bg-[var(--sto-sidebar-row-hover-bg)]'
              : 'bg-[var(--sto-sidebar-bg)] group-hover:bg-[var(--sto-sidebar-row-hover-bg)]',
            'text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
          )}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** 子项主行右侧内距，与 trailing 槽位对齐 */
export const SIDEBAR_TASK_SUBITEM_ROW_PR_CLASS = cn(sidebarSingleActionRowPaddingClass, 'pr-8');
