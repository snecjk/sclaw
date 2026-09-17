import type { ReactNode } from 'react';
import { CHANNEL_ICONS, CHANNEL_NAMES, type ChannelType } from '@/types/channel';
import { cn } from '@/lib/utils';
import wechatIcon from '@/assets/channels/wechat.svg?raw';
import dingtalkIcon from '@/assets/channels/dingtalk.svg?raw';
import { CHANNEL_BRAND_COLOR } from './styles';
import { tintChannelSvg } from './helpers';

const CHANNEL_ICON_RAW: Record<ChannelType, string> = {
  wechat: wechatIcon,
  dingtalk: dingtalkIcon,
};

export function ChannelLogo({ type, active = false }: { type: ChannelType; active?: boolean }) {
  const raw = CHANNEL_ICON_RAW[type];
  const brand = CHANNEL_BRAND_COLOR[type] ?? '#86909C';
  const label = CHANNEL_NAMES[type] || type;
  const fill = active ? brand : '#C9CDD4';

  if (!raw) {
    return (
      <span
        className={cn('text-[22px] leading-none', !active && 'grayscale opacity-45')}
        aria-hidden
      >
        {CHANNEL_ICONS[type] || '💬'}
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label={label}
      className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center [&_svg]:h-full [&_svg]:w-full"
      dangerouslySetInnerHTML={{ __html: tintChannelSvg(raw, fill) }}
    />
  );
}

export function ChannelIconBubble({
  type,
  active = false,
  children,
}: {
  type?: ChannelType;
  active?: boolean;
  children?: ReactNode;
}) {
  const brand = type ? CHANNEL_BRAND_COLOR[type] : undefined;
  const tinted = Boolean(active && brand);

  return (
    <div
      className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border',
        tinted
          ? 'border-transparent'
          : 'border-[#E5E6EB] bg-[#F7F8FA] dark:border-border dark:bg-muted/40',
      )}
      style={
        tinted
          ? {
              backgroundColor: `${brand}1A`,
              borderColor: `${brand}40`,
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}
