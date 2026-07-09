import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { isSiteUser, useAuthStore } from '@/stores/auth';
import { sidebarFooterSettingsIconClass } from '@/lib/surfaces';
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

const SUPPORT_QR_SIZE_PX = 320;
const SUPPORT_QR_TOOLTIP_SURFACE =
  '!bg-white dark:!bg-popover text-popover-foreground shadow-lg backdrop-blur-none border border-border !px-0 !py-0 !max-w-none overflow-visible rounded-xl';

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

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
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
      </TooltipTrigger>
      <TooltipContent
        side="right"
        align="end"
        sideOffset={8}
        collisionPadding={16}
        className={cn(SUPPORT_QR_TOOLTIP_SURFACE, 'w-[368px] pointer-events-auto')}
        onPointerDownOutside={() => setOpen(false)}
        onEscapeKeyDown={() => setOpen(false)}
      >
        <div className="flex max-h-[calc(100vh-24px)] flex-col items-center gap-3 overflow-y-auto p-5 text-center">
          {imgError ? (
            <p className="px-2 py-4 text-sm leading-5 text-muted-foreground">
              {t('sidebar.supportGroup.loadError')}
            </p>
          ) : (
            <img
              src={qrUrl}
              alt=""
              width={SUPPORT_QR_SIZE_PX}
              height={SUPPORT_QR_SIZE_PX}
              className="size-[320px] max-w-full shrink-0 rounded-lg object-contain"
              onError={() => setImgError(true)}
            />
          )}
          <div className="space-y-1">
            <p className="text-sm font-semibold leading-5 text-foreground">
              {t('sidebar.supportGroup.title')}
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              {t('sidebar.supportGroup.hint')}
            </p>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
