/**
 * SidebarRecentSessionRow — 侧边栏最近会话单行（含 inline 重命名 + 行尾菜单）。
 *
 * 使用位置：Sidebar 分组内 / 「最近」未分组列表
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
import type { SidebarRecentGroup } from '@/stores/sidebar-recent-groups';

export interface SidebarRecentSessionRowProps {
  /** 会话实体 */
  session: ChatSession;
  /** 展示标题（已走 getSessionLabel） */
  label: string;
  /** 是否当前选中会话 */
  isActive: boolean;
  /** 是否 inline 重命名中 */
  isEditing: boolean;
  /** 重命名 draft */
  editingValue: string;
  /** 全部分组 */
  groups: SidebarRecentGroup[];
  /** 当前 groupId；null = 未分组 */
  currentGroupId: string | null;
  /** 打开会话 */
  onOpen: () => void;
  onStartRename: () => void;
  onEditingValueChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
  onCreateGroup: () => void;
  onAssignGroup: (groupId: string) => void;
  onUngroup: () => void;
  className?: string;
}

export function SidebarRecentSessionRow({
  session,
  label,
  isActive,
  isEditing,
  editingValue,
  groups,
  currentGroupId,
  onOpen,
  onStartRename,
  onEditingValueChange,
  onCommitRename,
  onCancelRename,
  onDelete,
  onCreateGroup,
  onAssignGroup,
  onUngroup,
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
          groups={groups}
          currentGroupId={currentGroupId}
          onRename={onStartRename}
          onDelete={onDelete}
          onCreateGroup={onCreateGroup}
          onAssignGroup={onAssignGroup}
          onUngroup={onUngroup}
        />
      </div>
    </div>
  );
}
