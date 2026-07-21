/**
 * SidebarChannelSourceBadge — 历史会话行来源小标记（钉钉 / 微信 / App）。
 * PC 桌面会话（无 channelType）不展示。
 */
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { SidebarChannelSource } from '@/lib/session-channel-source';

const LABEL_KEY: Record<SidebarChannelSource, string> = {
  dingtalk: 'sidebar.channelSource.dingtalk',
  wechat: 'sidebar.channelSource.wechat',
  app: 'sidebar.channelSource.app',
};

export function SidebarChannelSourceBadge({
  source,
  className,
}: {
  source: SidebarChannelSource | null | undefined;
  className?: string;
}) {
  const { t } = useTranslation('common');
  if (!source) return null;

  return (
    <span
      className={cn(
        'ml-1.5 shrink-0 rounded px-1 py-px text-[10px] leading-3 font-medium tracking-wide',
        'border border-[#93c5fd] bg-[#eff6ff] text-[#3b82f6]',
        className,
      )}
      aria-label={t(LABEL_KEY[source])}
    >
      {t(LABEL_KEY[source])}
    </span>
  );
}
