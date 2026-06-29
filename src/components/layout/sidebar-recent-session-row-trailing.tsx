/**
 * SidebarRecentSessionRowTrailing — 最近会话行右侧：状态位 + hover 重命名/删除。
 *
 * 默认展示 running / 失败 / 未读；行 hover 时操作钮盖住状态位（与设计稿同槽位）。
 */
import { Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SidebarRecentSessionStatus } from '@/components/layout/sidebar-recent-session-status';
import { cn } from '@/lib/utils';
import { sidebarTextIconClass } from '@/lib/surfaces';

export interface SidebarRecentSessionRowTrailingProps {
  /** OpenClaw session key */
  sessionKey: string;
  /** 当前会话行是否选中（操作区底色与行态一致） */
  isActive?: boolean;
  /** 点击重命名 */
  onEdit: () => void;
  /** 点击删除 */
  onDelete: () => void;
  className?: string;
}

/** 右侧状态 / 操作区固定宽度，与 pr-12 行内距对齐 */
const SIDEBAR_RECENT_ROW_TRAILING_W_CLASS = 'w-12';

export function SidebarRecentSessionRowTrailing({
  sessionKey,
  isActive = false,
  onEdit,
  onDelete,
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
          'absolute inset-0 flex items-center justify-end gap-0',
          'invisible opacity-0 transition-opacity group-hover:visible group-hover:opacity-100',
          'rounded-md',
          isActive
            ? 'bg-[var(--sto-sidebar-subitem-active-bg)] group-hover:bg-[var(--sto-sidebar-row-hover-bg)]'
            : 'bg-[var(--sto-sidebar-bg)] group-hover:bg-[var(--sto-sidebar-row-hover-bg)]',
        )}
      >
        <button
          type="button"
          aria-label={t('actions.edit')}
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className={cn(
            'flex items-center justify-center rounded p-0.5',
            sidebarTextIconClass,
            'hover:bg-black/[0.04]',
          )}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={t('actions.delete')}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className={cn(
            'flex items-center justify-center rounded p-0.5',
            'text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
          )}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
