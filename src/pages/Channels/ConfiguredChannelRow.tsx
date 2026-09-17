import type { ReactNode } from 'react';
import { QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { stoSettingsSectionCardClass } from '@/lib/surfaces';
import { useTranslation } from 'react-i18next';
import { ChannelIconBubble, ChannelLogo } from './ChannelLogo';
import {
  accountDisplayName,
  channelStatusDotClass,
  channelTitle,
  configuredChannelSubtitle,
  normalizeLogoType,
} from './helpers';
import { channelBindOutlineBtnClass, channelOutlineBtnClass } from './styles';
import type {
  ChannelAccountItem,
  ChannelGroupItem,
  DingTalkBindingState,
} from './types';

function ScanBindButton({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <Button
      size="sm"
      variant="outline"
      className={channelBindOutlineBtnClass}
      onClick={onClick}
    >
      <QrCode className="mr-1.5 h-3.5 w-3.5" aria-hidden />
      {label}
    </Button>
  );
}

export function ConfiguredChannelRow({
  group,
  recommended,
  dingTalkBinding,
  onOpenDingTalkHub,
  onRequestUnbind,
  onOpenAccountEdit,
}: {
  group: ChannelGroupItem;
  recommended?: boolean;
  dingTalkBinding: DingTalkBindingState;
  onOpenDingTalkHub: () => void;
  onRequestUnbind: (channelType: string) => void;
  onOpenAccountEdit: (channelType: string, account?: ChannelAccountItem) => void;
}) {
  const { t } = useTranslation(['channels', 'common']);
  const isDingTalk = group.channelType === 'dingtalk';
  const isWeChat = group.channelType === 'openclaw-weixin' || group.channelType === 'wechat';
  const primaryAccount =
    group.accounts.find((account) => account.isDefault) || group.accounts[0];
  const weChatAccount = isWeChat ? primaryAccount : undefined;
  const pluginAccount = !isDingTalk && !isWeChat ? primaryAccount : undefined;

  const mainAccountLabel = t('account.mainAccount');
  const weChatDisplayName = accountDisplayName(weChatAccount, mainAccountLabel);
  const pluginDisplayName = accountDisplayName(pluginAccount, mainAccountLabel);
  const channelSubtitle = configuredChannelSubtitle({
    isDingTalk,
    isWeChat,
    dingTalkBinding,
    weChatAccount,
    pluginAccount,
    weChatDisplayName,
    pluginDisplayName,
    t,
  });
  const logoType = normalizeLogoType(group.channelType);

  let channelActive = Boolean(pluginAccount);
  if (isDingTalk) {
    channelActive = dingTalkBinding?.bindStatus === 'bound';
  } else if (isWeChat) {
    channelActive = Boolean(weChatAccount);
  }

  const scanBindLabel = t('account.scanBind', { defaultValue: '扫码绑定' });
  const unbindLabel = t('account.unbind', { defaultValue: '解除绑定' });

  let actionControls: ReactNode;
  if (isDingTalk) {
    actionControls = channelActive ? (
      <Button
        size="sm"
        variant="outline"
        className={channelOutlineBtnClass}
        onClick={() => onRequestUnbind(group.channelType)}
      >
        {unbindLabel}
      </Button>
    ) : (
      <ScanBindButton onClick={onOpenDingTalkHub} label={scanBindLabel} />
    );
  } else if (isWeChat) {
    actionControls = channelActive ? (
      <Button
        size="sm"
        variant="outline"
        className={channelOutlineBtnClass}
        onClick={() => onRequestUnbind(group.channelType)}
      >
        {unbindLabel}
      </Button>
    ) : (
      <ScanBindButton
        onClick={() => onOpenAccountEdit(group.channelType, undefined)}
        label={scanBindLabel}
      />
    );
  } else {
    actionControls = channelActive ? (
      <Button
        size="sm"
        variant="outline"
        className={channelOutlineBtnClass}
        onClick={() => onRequestUnbind(group.channelType)}
      >
        {unbindLabel}
      </Button>
    ) : (
      <ScanBindButton
        onClick={() => onOpenAccountEdit(group.channelType, undefined)}
        label={scanBindLabel}
      />
    );
  }

  return (
    <section className={stoSettingsSectionCardClass}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ChannelIconBubble type={logoType} active={channelActive}>
            <ChannelLogo type={logoType} active={channelActive} />
          </ChannelIconBubble>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-[15px] font-semibold text-[#1D2129] dark:text-foreground">
                {channelTitle(group.channelType)}
              </h3>
              {recommended ? (
                <Badge
                  variant="secondary"
                  className="rounded px-1.5 py-0 text-[10px] font-medium border-0 bg-[#FFF7E8] text-[#FF7D00] shadow-none dark:bg-orange-500/15 dark:text-orange-300"
                >
                  {t('recommendedBadge', { defaultValue: '推荐' })}
                </Badge>
              ) : null}
              <div className={channelStatusDotClass(group.status)} />
            </div>
            <p className="mt-0.5 truncate text-[12px] text-[#86909C] dark:text-muted-foreground">
              {channelSubtitle}
            </p>
            {isWeChat && weChatAccount?.lastError ? (
              <p className="mt-1 text-[12px] text-destructive">{weChatAccount.lastError}</p>
            ) : null}
            {pluginAccount?.lastError ? (
              <p className="mt-1 text-[12px] text-destructive">{pluginAccount.lastError}</p>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-nowrap items-center gap-1.5">
          {actionControls}
        </div>
      </div>
    </section>
  );
}
