/**
 * SidebarRecentSessionStatus — 会话状态位：运行中 / 失败（与未读红点互斥）。
 *
 * 使用位置：Sidebar「最近」「项目」行尾 idle 槽（hover 时由「...」覆盖）。
 */
import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { SidebarRunningIcon } from '@/components/layout/sidebar-running-icon';
import { useChatSessionRuntimeView } from '@/stores/chat/runtime-selectors';

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
  const runtime = useChatSessionRuntimeView(sessionKey);
  const isRunning = runtime.sending;
  const hasError = Boolean(runtime.error);

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

  return null;
}
