/**
 * 总部演示 — 账号切换入口（侧栏用户菜单：网点切回总部 / 总部级联选网点）。
 * 可见条件与原先右下角 FAB 一致；登录后拉取一次 options。
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronRight } from 'lucide-react';
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

export interface AccountSwitchMenuItemsProps {
  itemClassName: string;
  itemHoverClassName: string;
  subContentClassName: string;
}

export function AccountSwitchMenuItems({
  itemClassName,
  itemHoverClassName,
  subContentClassName,
}: AccountSwitchMenuItemsProps) {
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
      <DropdownMenuItem
        disabled={switching}
        onClick={() => {
          setSwitching(true);
          void switchBackToOrigin()
            .catch(() => {})
            .finally(() => setSwitching(false));
        }}
        className={cn(itemClassName, itemHoverClassName)}
      >
        {switching ? '切换中…' : t('accountSwitch.backToHq')}
      </DropdownMenuItem>
    );
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        disabled={switching}
        className={cn(itemClassName, itemHoverClassName, 'gap-2')}
      >
        <span className="flex-1">{switching ? '切换中…' : t('accountSwitch.menu')}</span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#86909C]" strokeWidth={2} />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent sideOffset={4} className={subContentClassName}>
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
            className={cn(itemClassName, itemHoverClassName, 'gap-2')}
          >
            {user?.code === option.code ? (
              <Check className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2.5} />
            ) : (
              <span className="w-3.5 shrink-0" />
            )}
            <span className="truncate">{option.label || option.code}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
