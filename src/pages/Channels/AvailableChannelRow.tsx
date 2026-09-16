import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CHANNEL_META, type ChannelType } from '@/types/channel';
import { stoSettingsSectionCardClass } from '@/lib/surfaces';
import { useTranslation } from 'react-i18next';
import { ChannelIconBubble, ChannelLogo } from './ChannelLogo';
import { channelOutlineBtnClass } from './styles';

export function AvailableChannelRow({
  type,
  recommended,
  onOpenDingTalkHub,
  onOpenConfig,
}: {
  type: ChannelType;
  recommended?: boolean;
  onOpenDingTalkHub: () => void;
  onOpenConfig: (type: ChannelType) => void;
}) {
  const { t } = useTranslation(['channels', 'common']);
  const meta = CHANNEL_META[type];
  const openAvailable = () => {
    if (type === 'dingtalk') {
      onOpenDingTalkHub();
      return;
    }
    onOpenConfig(type);
  };

  return (
    <section className={stoSettingsSectionCardClass}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ChannelIconBubble type={type} active={false}>
            <ChannelLogo type={type} active={false} />
          </ChannelIconBubble>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-[15px] font-semibold text-[#1D2129] dark:text-foreground">
                {meta.name}
              </h3>
              {recommended ? (
                <Badge
                  variant="secondary"
                  className="rounded px-1.5 py-0 text-[10px] font-medium border-0 bg-[#FFF7E8] text-[#FF7D00] shadow-none dark:bg-orange-500/15 dark:text-orange-300"
                >
                  {t('recommendedBadge', { defaultValue: '推荐' })}
                </Badge>
              ) : null}
              {meta.isPlugin ? (
                <Badge
                  variant="secondary"
                  className="rounded px-1.5 py-0 text-[10px] font-medium border-0 bg-[#F2F3F5] text-[#86909C] shadow-none dark:bg-white/[0.08] dark:text-muted-foreground"
                >
                  {t('pluginBadge')}
                </Badge>
              ) : null}
            </div>
            <p className="line-clamp-2 text-[13px] leading-relaxed text-[#86909C] dark:text-muted-foreground">
              {t(meta.description.replace('channels:', ''))}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className={channelOutlineBtnClass}
          onClick={openAvailable}
        >
          {t('account.bind', { defaultValue: '绑定' })}
        </Button>
      </div>
    </section>
  );
}
