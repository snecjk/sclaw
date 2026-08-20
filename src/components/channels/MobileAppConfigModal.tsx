import { useCallback, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useTranslation } from 'react-i18next';
import mobileAppQr from '@/assets/channels/sclaw-mobile-app-qr.png';

interface MobileAppConfigModalProps {
  enabled: boolean;
  busy?: boolean;
  onClose: () => void;
  /** 弹框内开关：开启 / 关闭 App 本地通道 */
  onToggle: (enabled: boolean) => void | Promise<void>;
}

export function MobileAppConfigModal({
  enabled,
  busy = false,
  onClose,
  onToggle,
}: MobileAppConfigModalProps) {
  const { t } = useTranslation('channels');
  const [toggling, setToggling] = useState(false);

  const handleToggle = useCallback(
    async (next: boolean) => {
      if (next === enabled) return;
      setToggling(true);
      try {
        await onToggle(next);
        if (next) onClose();
      } finally {
        setToggling(false);
      }
    },
    [enabled, onClose, onToggle],
  );

  const steps = [
    t('hub.mobile.modal.step1', {
      defaultValue: '扫描右侧二维码下载 App，并使用同一账号登录手机',
    }),
    t('hub.mobile.modal.step2', {
      defaultValue: '在电脑端开启 SClaw 开关',
    }),
    t('hub.mobile.modal.step3', {
      defaultValue: '连接成功后，手机 App 会显示绿色的「已连接电脑」',
    }),
    t('hub.mobile.modal.step4', {
      defaultValue: '下次打开后，App 可自动连接电脑',
    }),
  ];

  const actionBusy = busy || toggling;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.42)] p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !actionBusy) onClose();
      }}
    >
      <div
        className="relative w-full max-w-[560px] overflow-hidden rounded-[12px] border border-[#E5E6EB] bg-white shadow-[0_12px_40px_rgba(15,23,42,0.12)] dark:border-border dark:bg-card"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold leading-tight text-[#1D2129] dark:text-foreground">
              {t('hub.mobile.modal.title', {
                defaultValue: '配置移动端 SClaw（申懂懂）',
              })}
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-[#86909C] dark:text-muted-foreground">
              {t('hub.mobile.modal.subtitle', {
                defaultValue: '通过同账号连接 SClaw 官方 App',
              })}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-[#86909C] hover:bg-[#F7F8FA] hover:text-[#1D2129] dark:hover:bg-white/[0.04]"
            onClick={onClose}
            disabled={actionBusy}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="px-5 pb-5">
          <div className="rounded-[10px] bg-[#F7F8FA] px-4 py-4 dark:bg-muted/30">
            <p className="mb-3 text-[13px] font-medium text-[#1D2129] dark:text-foreground">
              {t('hub.mobile.modal.howToConnect', { defaultValue: '如何连接' })}
            </p>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <ol className="min-w-0 flex-1 list-decimal space-y-2.5 pl-4 text-[13px] leading-relaxed text-[#4E5969] dark:text-muted-foreground">
                {steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <div className="mx-auto flex shrink-0 flex-col items-center gap-2 sm:mx-0">
                <div className="rounded-[8px] border border-[#E5E6EB] bg-white p-2 dark:border-border">
                  <img
                    src={mobileAppQr}
                    alt={t('hub.mobile.modal.qrAlt', { defaultValue: '下载 App 二维码' })}
                    className="h-[160px] w-[160px] object-contain"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <span className="text-[13px] text-[#4E5969] dark:text-muted-foreground">
              {t('hub.mobile.modal.enableConnect', {
                defaultValue: '开启连接 App',
              })}
            </span>
            <Switch
              size="compact"
              checked={enabled}
              disabled={actionBusy}
              onCheckedChange={(checked) => {
                void handleToggle(checked);
              }}
              aria-label={t('hub.mobile.modal.enableConnect', {
                defaultValue: '开启连接 App',
              })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
