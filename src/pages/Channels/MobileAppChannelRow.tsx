import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import sclawAppLogo from '@/assets/logo.png';
import { channelOutlineBtnClass, MOBILE_APP_BRAND_COLOR } from './styles';
import type { MobileBindingState } from './types';

export function MobileAppChannelRow({
  mobileBinding,
  mobileToggleBusy,
  loading,
  onMobileToggle,
  onOpenConfig,
}: {
  mobileBinding: MobileBindingState;
  mobileToggleBusy: boolean;
  loading: boolean;
  onMobileToggle: (enabled: boolean) => void | Promise<void>;
  onOpenConfig: () => void;
}) {
  const { t } = useTranslation(['channels', 'common']);
  const mobileEnabled = Boolean(mobileBinding?.enabled);
  const mobileConfigured = Boolean(mobileBinding?.configured);

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border',
            mobileEnabled
              ? 'border-transparent'
              : 'border-[#E5E6EB] bg-[#F7F8FA] dark:border-border dark:bg-muted/40',
          )}
          style={
            mobileEnabled
              ? {
                  backgroundColor: `${MOBILE_APP_BRAND_COLOR}1A`,
                  borderColor: `${MOBILE_APP_BRAND_COLOR}40`,
                }
              : undefined
          }
        >
          <img
            src={sclawAppLogo}
            alt=""
            className={cn(
              'h-[22px] w-[22px] object-contain',
              !mobileEnabled && 'grayscale opacity-45',
            )}
          />
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold text-[#1D2129] dark:text-foreground">
            {t('hub.mobile.title')}
          </h3>
          <p className="mt-0.5 truncate text-[12px] text-[#86909C] dark:text-muted-foreground">
            {mobileBinding?.replaceHint === 'other_device'
              ? t('hub.mobile.replacedByOtherDevice', {
                  defaultValue: '已在其它设备绑定，请重新绑定',
                })
              : mobileBinding?.replaceHint === 'unbound'
                ? t('hub.mobile.replacedUnbound', {
                    defaultValue: '已解绑，请重新绑定',
                  })
                : t('hub.mobile.cardDesc', {
                    defaultValue: '通过移动端操作本地 agent',
                  })}
          </p>
          {mobileEnabled && !mobileBinding?.wsConnected && !mobileBinding?.replaceHint ? (
            <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
              {t('hub.mobile.hubOfflineHint')}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-nowrap items-center gap-1.5">
        {mobileEnabled ? (
          <Switch
            size="compact"
            checked
            disabled={mobileToggleBusy || loading}
            onCheckedChange={(checked) => {
              if (!checked) {
                void onMobileToggle(false);
              }
            }}
            aria-label={t('hub.mobile.toggleLabel')}
          />
        ) : (
          <Button
            size="sm"
            variant="outline"
            className={channelOutlineBtnClass}
            disabled={mobileToggleBusy || loading}
            onClick={onOpenConfig}
          >
            {mobileConfigured
              ? t('hub.mobile.configure', { defaultValue: '配置' })
              : t('account.bind', { defaultValue: '绑定' })}
          </Button>
        )}
      </div>
    </div>
  );
}
