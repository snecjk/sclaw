/**
 * SidebarRecentSessionRow — 侧边栏最近会话单行（含 inline 重命名 + 行尾菜单）。
 *
 * 使用位置：Sidebar「最近」列表
 */
import { useTranslation } from 'react-i18next';
import { SidebarRecentSessionRowTrailing } from '@/components/layout/sidebar-recent-session-row-trailing';
import { cn } from '@/lib/utils';
import {
  sidebarListItemTextClass,
  sidebarRecentSessionActiveClass,
  sidebarSubitemTextIdleClass,
} from '@/lib/surfaces';
import type { ChatSession } from '@/stores/chat/types';

export interface SidebarRecentSessionRowProps {
  /** 会话实体 */
  session: ChatSession;
  /** 展示标题（已走 getSessionLabel） */
  label: string;
  /** 是否当前选中会话 */
  isActive: boolean;
  /** 是否在「最近」中置顶 */
  isPinned: boolean;
  /** 是否 inline 重命名中 */
  isEditing: boolean;
  /** 重命名 draft */
  editingValue: string;
  /** 打开会话 */
  onOpen: () => void;
  onPin: () => void;
  onStartRename: () => void;
  onEditingValueChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
  className?: string;
}

export function SidebarRecentSessionRow({
  session,
  label,
  isActive,
  isPinned,
  isEditing,
  editingValue,
  onOpen,
  onPin,
  onStartRename,
  onEditingValueChange,
  onCommitRename,
  onCancelRename,
  onDelete,
  className,
}: SidebarRecentSessionRowProps) {
  const { t } = useTranslation('common');

  if (isEditing) {
    return (
      <div className={cn('relative flex w-full min-w-0 items-center', className)}>
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
          className={cn(
            'w-full rounded-[8px] border border-[var(--sto-brand-6)] bg-white px-[10px] py-[6px] pr-16 text-left text-sm leading-5 text-foreground outline-none',
          )}
        />
      </div>
    );
  }

  return (
    <div className={cn('relative flex w-full min-w-0 items-center', className)}>
      <div
        className={cn(
          'group relative flex h-9 w-full items-center rounded-lg transition-colors',
          isActive
            ? cn(sidebarRecentSessionActiveClass, 'hover:bg-[var(--sto-sidebar-row-hover-bg)]')
            : sidebarSubitemTextIdleClass,
        )}
      >
        <button
          type="button"
          onClick={onOpen}
          title={label}
          className="flex h-9 min-w-0 w-full flex-1 items-center overflow-hidden rounded-lg bg-transparent px-[10px] py-2 pr-12 text-left"
        >
          <span className={cn('min-w-0 flex-1 truncate', sidebarListItemTextClass, isActive && 'font-medium')}>
            {label}
          </span>
        </button>
        <SidebarRecentSessionRowTrailing
          sessionKey={session.key}
          isActive={isActive}
          isPinned={isPinned}
          onPin={onPin}
          onRename={onStartRename}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}
