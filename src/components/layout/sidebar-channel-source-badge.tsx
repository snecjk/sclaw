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
  wecom: 'sidebar.channelSource.wecom',
  app: 'sidebar.channelSource.app',
  qq: 'sidebar.channelSource.qq',
};

const SOURCE_COLOR_CLASS: Record<SidebarChannelSource, string> = {
  dingtalk: 'bg-[#eff6ff] text-[#3b82f6]',
  wechat: 'bg-[#EAFBF3] text-[#31AF65]',
  wecom: 'bg-[#EAFBF3] text-[#31AF65]',
  app: 'bg-[#FFF9F5] text-[#FF6700]',
  qq: 'bg-[#FFFBE6] text-[#FAAD14]',
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
        // 与会话行尾 16px 状态图标使用同一视觉高度；固定最小宽度，
        // 避免「钉钉 / 微信 / App」因字形宽度不同产生横向跳动。
        'ml-1.5 inline-flex h-4 min-w-8 shrink-0 items-center justify-center rounded px-1',
        'text-center text-[10px] font-medium leading-none tracking-wide',
        SOURCE_COLOR_CLASS[source],
        className,
      )}
      aria-label={t(LABEL_KEY[source])}
    >
      {t(LABEL_KEY[source])}
    </span>
  );
}
