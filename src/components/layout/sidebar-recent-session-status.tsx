/**
 * SidebarRecentSessionStatus — 最近会话行右侧状态位（运行 / 失败 / 未读，互斥，有优先级）。
 *
 * 使用位置：Sidebar 最近列表（展开 + 折叠图标列）。
 */
import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { SidebarRunningIcon } from '@/components/layout/sidebar-running-icon';
import { sidebarUnreadDotClass } from '@/lib/surfaces';
import { useChatStore } from '@/stores/chat';
import { readSessionUnread, useSessionUnreadStore } from '@/stores/session-unread';

export interface SidebarRecentSessionStatusProps {
  /** OpenClaw session key */
  sessionKey: string;
  /** 紧凑模式（折叠侧栏图标列） */
  isCompact?: boolean;
  className?: string;
}

export function SidebarRecentSessionStatus({
  sessionKey,
  isCompact = false,
  className,
}: SidebarRecentSessionStatusProps) {
  const { t } = useTranslation('common');
  const runtime = useChatStore((s) => s.runtimeBySessionKey[sessionKey]);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const currentSessionSending = useChatStore((s) => s.sending);
  const currentSessionActiveRunId = useChatStore((s) => s.activeRunId);
  const currentSessionError = useChatStore((s) => s.error);
  const unreadKeys = useSessionUnreadStore((s) => s.unreadKeys);

  const isCurrentSession = currentSessionKey === sessionKey;
  const isRunning = Boolean(
    runtime?.sending
    || runtime?.activeRunId
    || (isCurrentSession && (currentSessionSending || currentSessionActiveRunId)),
  );
  const hasError = Boolean(
    (runtime?.error != null && runtime.error !== '')
    || (isCurrentSession && currentSessionError != null && currentSessionError !== ''),
  );
  const isUnread = !isCurrentSession && readSessionUnread(unreadKeys, sessionKey);

  if (isRunning) {
    return (
      <SidebarRunningIcon
        isCompact={isCompact}
        className={className}
        ariaLabel={t('sidebar.sessionRunning')}
      />
    );
  }

  if (hasError) {
    return (
      <AlertCircle
        className={cn(
          'shrink-0 text-destructive',
          isCompact ? 'h-3 w-3' : 'h-3.5 w-3.5',
          className,
        )}
        aria-label={t('sidebar.sessionFailed')}
      />
    );
  }

  if (isUnread) {
    return (
      <span
        className={cn(sidebarUnreadDotClass, className)}
        aria-label={t('sidebar.sessionUnread')}
      />
    );
  }

  return null;
}
