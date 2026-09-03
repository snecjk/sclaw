import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { isSiteUser, useAuthStore } from '@/stores/auth';
import {
  sidebarFooterPopoverBodyClass,
  sidebarFooterPopoverContentClass,
  sidebarFooterSettingsIconClass,
} from '@/lib/surfaces';
import { resolveSupportGroupQrUrl } from '../../../shared/support-group-qr';

/** Lucide CircleHelp paths — circle thin, question mark heavier. */
function CircleHelpBoldQuestion({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" strokeWidth={1.5} />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" strokeWidth={2.25} />
      <path d="M12 17h.01" strokeWidth={2.25} />
    </svg>
  );
}

type SidebarSupportQrTooltipProps = {
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function SidebarSupportQrTooltip({
  className,
  open: openProp,
  onOpenChange,
}: SidebarSupportQrTooltipProps) {
  const { t } = useTranslation('common');
  const user = useAuthStore((s) => s.user);
  const siteDepartmentTypes = useAuthStore((s) => s.siteDepartmentTypes);
  const [imgError, setImgError] = useState(false);
  const [internalOpen, setInternalOpen] = useState(false);

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

  const qrUrl = useMemo(() => {
    const isSite =
      siteDepartmentTypes !== null && isSiteUser(user?.categoryCode);
    return resolveSupportGroupQrUrl(isSite);
  }, [siteDepartmentTypes, user?.categoryCode]);

  useEffect(() => {
    setImgError(false);
  }, [qrUrl]);

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
          aria-label={t('sidebar.supportGroup.helpAria')}
          aria-expanded={open}
        >
          <CircleHelpBoldQuestion className={sidebarFooterSettingsIconClass} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="end"
        sideOffset={8}
        collisionPadding={16}
        className={sidebarFooterPopoverContentClass}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div className={sidebarFooterPopoverBodyClass}>
          {imgError ? (
            <p className="flex min-h-[160px] items-center justify-center rounded-[10px] bg-[var(--sto-surface-subtle)] px-4 py-6 text-center text-sm leading-5 text-muted-foreground">
              {t('sidebar.supportGroup.loadError')}
            </p>
          ) : (
            <img
              src={qrUrl}
              alt=""
              className="h-auto w-full rounded-[10px] object-contain"
              onError={() => setImgError(true)}
            />
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
