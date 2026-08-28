/** SidebarChannelSourceBadge — 历史会话行来源图标；PC 桌面会话不展示。 */
import { useTranslation } from 'react-i18next';
import dingIcon from '@/assets/icons/ding.svg';
import wechatIcon from '@/assets/icons/wechat.svg';
import wecomIcon from '@/assets/icons/wecom.svg';
import appIcon from '@/assets/icons/app.svg';
import qqIcon from '@/assets/icons/qq.svg';
import { cn } from '@/lib/utils';
import type { SidebarChannelSource } from '@/lib/session-channel-source';

const LABEL_KEY: Record<SidebarChannelSource, string> = {
  dingtalk: 'sidebar.channelSource.dingtalk',
  wechat: 'sidebar.channelSource.wechat',
  wecom: 'sidebar.channelSource.wecom',
  app: 'sidebar.channelSource.app',
  qq: 'sidebar.channelSource.qq',
};

const SOURCE_ICON: Record<SidebarChannelSource, string> = {
  dingtalk: dingIcon,
  wechat: wechatIcon,
  wecom: wecomIcon,
  app: appIcon,
  qq: qqIcon,
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
        'ml-1.5 inline-flex h-4 w-4 shrink-0 items-center justify-center',
        className,
      )}
      aria-label={t(LABEL_KEY[source])}
    >
      <img src={SOURCE_ICON[source]} alt="" className="h-4 w-4" aria-hidden />
    </span>
  );
}
