import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MonitorSmartphone } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { hostApiFetch } from '@/lib/host-api';
import { sidebarFooterSettingsIconClass } from '@/lib/surfaces';
import mobileAppQr from '@/assets/channels/sclaw-mobile-app-qr.png';
import { toast } from 'sonner';

type SidebarMobileConnectTooltipProps = {
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function SidebarMobileConnectTooltip({
  className,
  open: openProp,
  onOpenChange,
}: SidebarMobileConnectTooltipProps) {
  const { t } = useTranslation(['channels', 'common']);
  const navigate = useNavigate();
  const [internalOpen, setInternalOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;

  const setOpen = (next: boolean) => {
    if (isControlled) {
      onOpenChange?.(next);
    } else {
      setInternalOpen(next);
      onOpenChange?.(next);
    }
  };

  const refreshStatus = useCallback(async () => {
    try {
      const res = await hostApiFetch<{
        success?: boolean;
        local?: { bindStatus?: string; enabled?: boolean };
      }>('/api/channels/hub/mobile/status');
      const local = res?.local;
      setEnabled(Boolean(local?.bindStatus === 'bound' && local?.enabled !== false));
    } catch {
      // ignore — keep last known
    }
  }, []);

  useEffect(() => {
    if (open) {
      void refreshStatus();
    }
  }, [open, refreshStatus]);

  const handleToggle = useCallback(
    async (next: boolean) => {
      if (busy || next === enabled) return;
      setBusy(true);
      try {
        const path = next
          ? '/api/channels/hub/mobile/bind/enable'
          : '/api/channels/hub/mobile/bind/disable';
        await hostApiFetch<{ success?: boolean; error?: string }>(path, { method: 'POST' });
        if (next && typeof localStorage !== 'undefined') {
          localStorage.setItem('sclaw.mobile.configured', '1');
        }
        setEnabled(next);
        toast.success(
          next
            ? t('hub.mobile.enableSuccess')
            : t('hub.mobile.disableSuccess'),
        );
      } catch (error) {
        toast.error(
          t('hub.mobile.toggleFailed', { error: String(error) }),
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, enabled, t],
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex shrink-0 items-center justify-center rounded-[8px] px-2 py-3 text-[var(--sto-sidebar-collapsed-nav-icon-idle)] transition-colors hover:bg-[var(--sto-sidebar-row-hover-bg)] hover:text-foreground',
            open && 'bg-[var(--sto-sidebar-row-hover-bg)] text-foreground',
            className,
          )}
          aria-label={t('hub.mobile.title')}
          aria-expanded={open}
          title={t('hub.mobile.title')}
        >
          <MonitorSmartphone className={sidebarFooterSettingsIconClass} strokeWidth={1.75} aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="end"
        sideOffset={8}
        collisionPadding={16}
        className={cn(
          'z-[60000] w-[260px] overflow-hidden rounded-[12px] border border-[#E5E6EB] !bg-white p-0 shadow-[0_8px_24px_rgba(15,23,42,0.12)]',
          'dark:border-border dark:!bg-popover',
        )}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {/* 整卡内容都在弹框内：灰底二维码区 + 开关 + 更多频道 */}
        <div className="flex flex-col gap-3 p-3">
          <div className="flex flex-col items-center rounded-[10px] bg-[#F2F3F5] px-4 pb-3.5 pt-4 dark:bg-muted/50">
            <img
              src={mobileAppQr}
              alt=""
              className="h-[120px] w-[120px] rounded-[6px] bg-white object-contain p-1.5"
            />
            <p className="mt-3 text-center text-[14px] font-semibold leading-tight text-[#1D2129] dark:text-foreground">
              {t('hub.mobile.title')}
            </p>
            <p className="mt-1 text-center text-[12px] leading-relaxed text-[#86909C] dark:text-muted-foreground">
              {t('hub.mobile.footerQrHint', {
                defaultValue: '一键下载，把工作台装进口袋',
              })}
            </p>
          </div>

          <div className="flex items-center gap-2.5 px-0.5">
            <Switch
              size="compact"
              checked={enabled}
              disabled={busy}
              onCheckedChange={(checked) => {
                void handleToggle(checked);
              }}
              aria-label={t('hub.mobile.modal.enableConnect', {
                defaultValue: '开启连接 App',
              })}
            />
            <span className="min-w-0 flex-1 text-[12px] leading-snug text-[#4E5969] dark:text-muted-foreground">
              {t('hub.mobile.footerConnectHint', {
                defaultValue: '连接 app，确保同账号登录手机',
              })}
            </span>
          </div>

          <button
            type="button"
            className="w-full py-1 text-center text-[12px] font-normal text-[#86909C] transition-colors hover:text-[#165DFF] dark:text-muted-foreground dark:hover:text-blue-400"
            onClick={() => {
              setOpen(false);
              navigate('/settings/channels');
            }}
          >
            {t('hub.mobile.footerMoreChannels', {
              defaultValue: '点击绑定更多频道',
            })}
          </button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
