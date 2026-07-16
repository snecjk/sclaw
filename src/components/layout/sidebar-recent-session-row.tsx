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
  sidebarUnreadDotClass,
} from '@/lib/surfaces';
import type { ChatSession } from '@/stores/chat/types';
import type { WorkspaceDto } from '@/lib/session-catalog-api';
import { useChatStore } from '@/stores/chat';
import { readSessionUnread, useSessionUnreadStore } from '@/stores/session-unread';

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
  /** 用户项目 */
  projects: WorkspaceDto[];
  /** 当前项目 id；null = 默认对话 */
  currentProjectId: string | null;
  /** 打开会话 */
  onOpen: () => void;
  onPin: () => void;
  onStartRename: () => void;
  onEditingValueChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
  onMoveToProject: (projectId: string) => void;
  onCreateProject: () => void;
  className?: string;
}

export function SidebarRecentSessionRow({
  session,
  label,
  isActive,
  isPinned,
  isEditing,
  editingValue,
  projects,
  currentProjectId,
  onOpen,
  onPin,
  onStartRename,
  onEditingValueChange,
  onCommitRename,
  onCancelRename,
  onDelete,
  onMoveToProject,
  onCreateProject,
  className,
}: SidebarRecentSessionRowProps) {
  const { t } = useTranslation('common');
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const runtime = useChatStore((s) => s.runtimeBySessionKey[session.key]);
  const currentSessionSending = useChatStore((s) => s.sending);
  const currentSessionActiveRunId = useChatStore((s) => s.activeRunId);
  const currentSessionError = useChatStore((s) => s.error);
  const unreadKeys = useSessionUnreadStore((s) => s.unreadKeys);
  const isCurrentSession = currentSessionKey === session.key;
  const isRunning = Boolean(
    runtime?.sending
    || runtime?.activeRunId
    || (isCurrentSession && (currentSessionSending || currentSessionActiveRunId)),
  );
  const hasError = Boolean(
    (runtime?.error != null && runtime.error !== '')
    || (isCurrentSession && currentSessionError != null && currentSessionError !== ''),
  );
  const showUnreadDot = !isCurrentSession
    && !isRunning
    && !hasError
    && readSessionUnread(unreadKeys, session.key);

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
          {showUnreadDot ? (
            <span
              className={cn(sidebarUnreadDotClass, 'mr-2 shrink-0')}
              aria-label={t('sidebar.sessionUnread')}
            />
          ) : null}
          <span className={cn('min-w-0 flex-1 truncate', sidebarListItemTextClass, isActive && 'font-medium')}>
            {label}
          </span>
        </button>
        <SidebarRecentSessionRowTrailing
          sessionKey={session.key}
          isActive={isActive}
          isPinned={isPinned}
          projects={projects}
          currentProjectId={currentProjectId}
          onPin={onPin}
          onRename={onStartRename}
          onDelete={onDelete}
          onMoveToProject={onMoveToProject}
          onCreateProject={onCreateProject}
        />
      </div>
    </div>
  );
}
