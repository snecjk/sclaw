/**
 * 总部演示 — 可切换网点时右下角浮动入口（登录后拉取一次 options，不重复请求）。
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

export function AccountSwitchFab() {
  const { t } = useTranslation('auth');
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const impersonationOrigin = useAuthStore((s) => s.impersonationOrigin);
  const accountSwitchOptions = useAuthStore((s) => s.accountSwitchOptions);
  const accountSwitchOptionsStatus = useAuthStore((s) => s.accountSwitchOptionsStatus);
  const loadAccountSwitchOptions = useAuthStore((s) => s.loadAccountSwitchOptions);
  const switchToAccount = useAuthStore((s) => s.switchToAccount);
  const switchBackToOrigin = useAuthStore((s) => s.switchBackToOrigin);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (!isAuthenticated && !user) return;
    if (impersonationOrigin) return;
    if (accountSwitchOptionsStatus === 'idle') {
      void loadAccountSwitchOptions();
    }
  }, [
    isAuthenticated,
    user,
    impersonationOrigin,
    accountSwitchOptionsStatus,
    loadAccountSwitchOptions,
  ]);

  const showSwitchBack = impersonationOrigin != null;
  const showSwitchMenu =
    !showSwitchBack
    && accountSwitchOptionsStatus === 'loaded'
    && accountSwitchOptions.length > 0;

  if (!showSwitchBack && !showSwitchMenu) {
    return null;
  }

  if (showSwitchBack) {
    return (
      <button
        type="button"
        disabled={switching}
        onClick={() => {
          setSwitching(true);
          void switchBackToOrigin()
            .catch(() => {})
            .finally(() => setSwitching(false));
        }}
        className="no-drag fixed bottom-4 right-4 z-[99998] flex items-center gap-2 rounded-lg border border-[var(--sto-brand-6)]/30 bg-white px-3 py-2 text-xs font-medium text-[var(--sto-brand-6)] shadow-lg transition-colors hover:bg-[var(--sto-brand-6)]/5 disabled:cursor-wait disabled:opacity-70 dark:bg-card"
      >
        <ArrowLeftRight className="h-4 w-4 shrink-0" strokeWidth={2} />
        {switching ? '切换中…' : t('accountSwitch.backToHq')}
      </button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={switching}
          className="no-drag fixed bottom-4 right-4 z-[99998] flex items-center gap-2 rounded-lg border border-[var(--sto-brand-6)]/30 bg-white px-3 py-2 text-xs font-medium text-[var(--sto-brand-6)] shadow-lg transition-colors hover:bg-[var(--sto-brand-6)]/5 disabled:cursor-wait disabled:opacity-70 dark:bg-card"
        >
          <ArrowLeftRight className="h-4 w-4 shrink-0" strokeWidth={2} />
          {switching ? '切换中…' : t('accountSwitch.menu')}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" sideOffset={8} className="min-w-[12rem]">
        {accountSwitchOptions.map((option) => (
          <DropdownMenuItem
            key={option.code}
            disabled={switching || user?.code === option.code}
            onClick={() => {
              setSwitching(true);
              void switchToAccount(option.code)
                .catch(() => {})
                .finally(() => setSwitching(false));
            }}
            className={cn('gap-2')}
          >
            {user?.code === option.code ? (
              <Check className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2.5} />
            ) : (
              <span className="w-3.5 shrink-0" />
            )}
            <span className="truncate">{option.label || option.code}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
