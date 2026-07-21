/**
 * SidebarProjectSessionRow — 项目树内嵌套会话行。
 *
 * 布局与「最近」对齐：标题纯文字；行尾最右侧非 hover 显示状态（或置顶钉），hover 用「...」覆盖。
 */
import { useTranslation } from 'react-i18next';
import { SidebarChannelSourceBadge } from '@/components/layout/sidebar-channel-source-badge';
import { SidebarProjectSessionRowTrailing } from '@/components/layout/sidebar-project-session-row-trailing';
import { cn } from '@/lib/utils';
import {
  sidebarListItemTextClass,
  sidebarRecentSessionActiveClass,
  sidebarSubitemTextIdleClass,
} from '@/lib/surfaces';
import type { SidebarChannelSource } from '@/lib/session-channel-source';
import type { ChatSession } from '@/stores/chat/types';
import { isProjectNewChatDraftKey } from '@/stores/chat/types';
import { useChatStore } from '@/stores/chat';
import { readSessionUnread, useSessionUnreadStore } from '@/stores/session-unread';
import { handleSidebarSessionDoubleClick } from '@/lib/sidebar-project-session-navigation';

export interface SidebarProjectSessionRowProps {
  session: ChatSession;
  label: string;
  isActive: boolean;
  isPinned: boolean;
  channelSource?: SidebarChannelSource | null;
  isEditing: boolean;
  editingValue: string;
  onOpen: () => void;
  onPin: () => void;
  onStartRename: () => void;
  onEditingValueChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
}

export function SidebarProjectSessionRow({
  session,
  label,
  isActive,
  isPinned,
  channelSource = null,
  isEditing,
  editingValue,
  onOpen,
  onPin,
  onStartRename,
  onEditingValueChange,
  onCommitRename,
  onCancelRename,
  onDelete,
}: SidebarProjectSessionRowProps) {
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
  const hasStatusMarker = showUnreadDot || isRunning || hasError;
  const isDraft = isProjectNewChatDraftKey(session.key);

  if (isEditing) {
    return (
      <div className="relative flex w-full min-w-0 items-center pl-6">
        {/* 编辑态同样保留层级竖线，避免二级行左右跳动 */}
        <span
          className="pointer-events-none absolute bottom-0 left-[17px] top-0 w-px bg-[#DCDCDC] dark:bg-border"
          aria-hidden
        />
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
          className="h-8 w-full rounded-[8px] border border-[var(--sto-brand-6)] bg-card px-[10px] py-[5px] pr-16 text-left text-sm leading-5 text-foreground outline-none"
        />
      </div>
    );
  }

  return (
    <div className="relative flex w-full min-w-0 items-center pl-6">
      {/* MasterGo 项目二级：左侧层级竖线 #DCDCDC，对齐一级 folder 中心 */}
      <span
        className="pointer-events-none absolute bottom-0 left-[17px] top-0 w-px bg-[#DCDCDC] dark:bg-border"
        aria-hidden
      />
      <div
        className={cn(
          'group relative flex h-8 w-full items-center rounded-lg transition-colors',
          isActive
            ? cn(sidebarRecentSessionActiveClass, 'hover:bg-[var(--sto-sidebar-row-hover-bg)]')
            : sidebarSubitemTextIdleClass,
        )}
      >
        <button
          type="button"
          onClick={onOpen}
          onDoubleClick={() => handleSidebarSessionDoubleClick(session.key, onStartRename)}
          title={label}
          className="flex h-8 min-w-0 w-full flex-1 items-center overflow-hidden rounded-lg bg-transparent px-[10px] py-1.5 pr-12 text-left"
        >
          <span className="flex min-w-0 flex-1 items-center gap-0">
            <span className={cn('min-w-0 flex-1 truncate', sidebarListItemTextClass, isActive && 'font-medium')}>
              {label}
            </span>
            <SidebarChannelSourceBadge source={channelSource} />
          </span>
        </button>
        <SidebarProjectSessionRowTrailing
          sessionKey={session.key}
          isActive={isActive}
          isPinned={isPinned}
          isDraft={isDraft}
          showUnreadDot={showUnreadDot}
          hasStatusMarker={hasStatusMarker}
          onPin={onPin}
          onRename={onStartRename}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}
