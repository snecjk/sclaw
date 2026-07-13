/**
 * SidebarProjectSessionRow — 项目树内嵌套会话行（高亮 + 行尾菜单）。
 */
import { Circle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SidebarProjectSessionRowTrailing } from '@/components/layout/sidebar-project-session-row-trailing';
import { cn } from '@/lib/utils';
import {
  sidebarListItemTextClass,
  sidebarRecentSessionActiveClass,
  sidebarSubitemTextIdleClass,
} from '@/lib/surfaces';
import type { ChatSession } from '@/stores/chat/types';

export interface SidebarProjectSessionRowProps {
  session: ChatSession;
  label: string;
  isActive: boolean;
  isPinned: boolean;
  isEditing: boolean;
  editingValue: string;
  onOpen: () => void;
  onPin: () => void;
  onStartRename: () => void;
  onEditingValueChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onRemoveFromProject: () => void;
  onDelete: () => void;
}

export function SidebarProjectSessionRow({
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
  onRemoveFromProject,
  onDelete,
}: SidebarProjectSessionRowProps) {
  const { t } = useTranslation('common');

  if (isEditing) {
    return (
      <div className="relative flex w-full min-w-0 items-center pl-5">
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
          className="w-full rounded-[8px] border border-[var(--sto-brand-6)] bg-white px-[10px] py-[6px] pr-16 text-left text-sm leading-5 text-foreground outline-none"
        />
      </div>
    );
  }

  return (
    <div className="relative flex w-full min-w-0 items-center pl-5">
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
          className="flex h-9 min-w-0 w-full flex-1 items-center gap-2 overflow-hidden rounded-lg bg-transparent px-[10px] py-2 pr-12 text-left"
        >
          <Circle className="h-2 w-2 shrink-0 stroke-[1.5] text-muted-foreground" aria-hidden />
          <span className={cn('min-w-0 flex-1 truncate', sidebarListItemTextClass, isActive && 'font-medium')}>
            {label}
          </span>
        </button>
        <SidebarProjectSessionRowTrailing
          sessionKey={session.key}
          isActive={isActive}
          isPinned={isPinned}
          onPin={onPin}
          onRename={onStartRename}
          onRemoveFromProject={onRemoveFromProject}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}
