import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MonitorSmartphone, ChevronRight } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { hostApiFetch } from '@/lib/host-api';
import {
  sidebarFooterPopoverBodyClass,
  sidebarFooterPopoverContentClass,
  sidebarFooterSettingsIconClass,
} from '@/lib/surfaces';
import mobileAppQr from '@/assets/channels/sclaw-mobile-app-qr.png';
import { toast } from 'sonner';
import { SidebarTooltip } from '@/components/layout/sidebar-tooltip';

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
      <SidebarTooltip label={t('hub.mobile.title')} sideOffset={8}>
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
        >
          <MonitorSmartphone className={sidebarFooterSettingsIconClass} strokeWidth={1.75} aria-hidden />
        </button>
      </DropdownMenuTrigger>
      </SidebarTooltip>
      <DropdownMenuContent
        side="right"
        align="end"
        sideOffset={8}
        collisionPadding={16}
        className={sidebarFooterPopoverContentClass}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {/* 整卡内容都在弹框内：灰底二维码区 + 开关 + 更多频道 */}
        <div className={sidebarFooterPopoverBodyClass}>
          <div className="flex flex-col items-center rounded-[10px] bg-[var(--sto-surface-subtle)] px-4 pb-3.5 pt-4">
            <img
              src={mobileAppQr}
              alt=""
              className="h-[120px] w-[120px] rounded-[6px] bg-white object-contain p-1.5"
            />
            <p className="mt-3 text-center text-[14px] font-semibold leading-tight text-[var(--sto-text-primary)]">
              {t('hub.mobile.title')}
            </p>
            <p className="mt-1 text-center text-[12px] leading-relaxed text-[var(--sto-text-tertiary)]">
              {t('hub.mobile.footerQrHint', {
                defaultValue: '一键下载，把工作台装进口袋',
              })}
            </p>
          </div>

          <div className="flex flex-col gap-3 px-0.5">
            <div className="flex items-center gap-2.5">
              <span className="min-w-0 flex-1 text-[12px] leading-snug text-[var(--sto-text-secondary)]">
                {t('hub.mobile.footerConnectHint', {
                  defaultValue: '连接 app，确保同账号登录手机',
                })}
              </span>
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
            </div>

            <div className="h-px w-full bg-[var(--sto-surface-subtle)]" aria-hidden />

            <button
              type="button"
              className="group flex w-full items-center justify-start gap-1.5 text-left transition-colors"
              onClick={() => {
                setOpen(false);
                navigate('/settings/channels');
              }}
            >
              <span className="min-w-0 text-[12px] font-normal leading-snug text-[var(--sto-text-tertiary)] transition-colors group-hover:text-[var(--sto-link-hover-foreground)]">
                {t('hub.mobile.footerMoreChannels', {
                  defaultValue: '点击绑定更多频道',
                })}
              </span>
              <ChevronRight
                className="h-3.5 w-3.5 shrink-0 text-[var(--sto-icon-tertiary)] transition-colors group-hover:text-[var(--sto-link-hover-foreground)]"
                strokeWidth={1.75}
                aria-hidden
              />
            </button>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
