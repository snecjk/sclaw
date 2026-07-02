import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useUpdateStore } from '@/stores/update';
import { cn } from '@/lib/utils';
import { dismissUpdate, isUpdateDismissed } from '@/lib/update-dismiss-storage';
import { UpdateContentModal } from './update-content-modal';

interface SidebarUpdateNoticeProps {
  collapsed: boolean;
}

const VISIBLE_STATUSES = new Set([
  'available',
  'downloading',
  'downloaded',
  'installing',
  'installed',
  'error',
]);

function SyncIcon({ spinning = false, className }: { spinning?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#E8F7EE] text-[#00B54B]',
        className,
      )}
    >
      <RefreshCw className={cn('h-3.5 w-3.5', spinning && 'animate-spin')} strokeWidth={2.25} />
    </span>
  );
}

/** 侧边栏更新卡片 — 对齐 MasterGo 稿 */
const updateCardClass = cn(
  'rounded-xl bg-white p-3.5',
  'shadow-[0_2px_12px_rgba(15,23,42,0.06)]',
  'dark:border dark:border-[var(--sto-sidebar-border)] dark:bg-card dark:shadow-none',
);

const updatePrimaryBtnClass = cn(
  'inline-flex h-7 min-h-7 flex-[1.72] items-center justify-center rounded-lg border-0 px-2',
  'text-[12px] font-medium leading-none',
  'bg-[#1D2129] text-white hover:bg-[#1D2129]/90',
  'disabled:cursor-not-allowed disabled:opacity-60',
  'dark:bg-foreground dark:text-background dark:hover:bg-foreground/90',
);

const updateSecondaryBtnClass = cn(
  'inline-flex h-7 min-h-7 flex-1 items-center justify-center rounded-lg border-0 px-2',
  'text-[12px] font-medium leading-none',
  'bg-[#F0F2F5] text-[#1D2129] hover:bg-[#E5E6EB]',
  'dark:bg-muted dark:text-foreground dark:hover:bg-muted/80',
);

const updateOutlineBtnClass = cn(
  'inline-flex h-7 min-h-7 w-full items-center justify-center rounded-lg',
  'border border-[#E5E6EB] bg-white px-2 text-[12px] font-medium leading-none text-[#1D2129]',
  'hover:bg-[#FAFBFC] dark:border-[var(--sto-sidebar-border)] dark:bg-card dark:hover:bg-muted/40',
);

export function SidebarUpdateNotice({ collapsed }: SidebarUpdateNoticeProps) {
  const { t } = useTranslation('settings');
  const {
    status,
    updateInfo,
    progress,
    error,
    autoInstallCountdown,
    restartCountdown,
    isInitialized,
    init,
    downloadUpdate,
    installUpdate,
    restartApp,
    cancelRestartCountdown,
    cancelAutoInstall,
    checkForUpdates,
    clearError,
  } = useUpdateStore();

  const [modalOpen, setModalOpen] = useState(false);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

  const version = updateInfo?.version?.trim() || '';

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (status === 'available' && updateInfo?.version) {
      setDismissedVersion(isUpdateDismissed(updateInfo.version) ? updateInfo.version : null);
    }
  }, [status, updateInfo?.version]);

  const handleDismiss = useCallback(() => {
    if (!updateInfo?.version) return;
    dismissUpdate(updateInfo.version);
    setDismissedVersion(updateInfo.version);
  }, [updateInfo?.version]);

  const handleRetry = useCallback(async () => {
    clearError();
    await checkForUpdates();
  }, [checkForUpdates, clearError]);

  const isDismissed =
    status === 'available' &&
    updateInfo?.version != null &&
    (dismissedVersion === updateInfo.version || isUpdateDismissed(updateInfo.version));

  const shouldShow =
    isInitialized && VISIBLE_STATUSES.has(status) && !(status === 'available' && isDismissed);

  if (!shouldShow) return null;

  const percent = Math.round(progress?.percent ?? 0);

  const collapsedLabel =
    status === 'downloading' || status === 'installing'
      ? t('updates.sidebar.updating')
      : status === 'available'
        ? t('updates.sidebar.newVersionTitle')
        : status === 'downloaded'
          ? t('updates.status.downloaded', { version })
          : status === 'installed'
            ? t('updates.status.installed', { version })
            : t('updates.status.failed');

  if (collapsed) {
    return (
      <>
        <div className="shrink-0 bg-[var(--sto-sidebar-bg)] px-2 pt-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="mx-auto flex h-9 w-9 items-center justify-center rounded-[8px] border border-[var(--sto-sidebar-border)] bg-white shadow-sm dark:bg-card"
                aria-label={collapsedLabel}
              >
                <SyncIcon spinning={status === 'downloading' || status === 'installing'} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{collapsedLabel}</TooltipContent>
          </Tooltip>
        </div>
        <UpdateContentModal
          open={modalOpen}
          version={updateInfo?.version}
          title={updateInfo?.title}
          releaseNotes={updateInfo?.releaseNotes}
          onClose={() => setModalOpen(false)}
        />
      </>
    );
  }

  const cardClass = updateCardClass;

  const renderAvailableCard = () => (
    <div className={cardClass}>
      <div className="mb-3 flex items-start gap-2">
        <SyncIcon className="mt-px" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-[18px] text-[#1D2129] dark:text-foreground">
            {t('updates.sidebar.newVersionTitle')}
          </p>
          <p className="mt-1 text-[12px] leading-[17px] text-[#86909C]">
            {t('updates.sidebar.updateToVersion', { version })}
          </p>
        </div>
      </div>
      <div className="flex gap-1.5">
        <button type="button" className={updatePrimaryBtnClass} onClick={() => void downloadUpdate()}>
          {t('updates.sidebar.updateNow')}
        </button>
        <button type="button" className={updateSecondaryBtnClass} onClick={handleDismiss}>
          {t('updates.sidebar.later')}
        </button>
      </div>
    </div>
  );

  const renderDownloadingCard = () => (
    <div className={cardClass}>
      <div className="mb-2.5 flex items-center gap-2">
        <SyncIcon spinning />
        <p className="text-[13px] font-semibold leading-[18px] text-[#1D2129] dark:text-foreground">
          {t('updates.sidebar.updating')}
        </p>
      </div>
      <div className="mb-2.5 flex items-center gap-2">
        <Progress
          value={percent}
          className="h-1 flex-1 bg-[#F0F2F5] [&>div]:rounded-full [&>div]:bg-[#00B54B]"
        />
        <span className="w-8 shrink-0 text-right text-[11px] font-medium tabular-nums text-[#86909C]">
          {percent}%
        </span>
      </div>
      <button type="button" className={updateOutlineBtnClass} onClick={() => setModalOpen(true)}>
        {t('updates.sidebar.viewUpdate')}
      </button>
    </div>
  );

  const renderCompactCard = (
    title: string,
    primaryLabel: string,
    onPrimary: () => void,
    secondaryLabel?: string,
    onSecondary?: () => void,
  ) => (
    <div className={cardClass}>
      <div className="mb-3 flex items-start gap-2">
        <SyncIcon spinning={status === 'installing'} className="mt-px" />
        <p className="min-w-0 flex-1 text-[13px] font-semibold leading-[18px] text-[#1D2129] dark:text-foreground">
          {title}
        </p>
      </div>
      <div className="flex gap-1.5">
        {secondaryLabel && onSecondary ? (
          <button type="button" className={updateSecondaryBtnClass} onClick={onSecondary}>
            {secondaryLabel}
          </button>
        ) : null}
        <button
          type="button"
          className={cn(updatePrimaryBtnClass, !secondaryLabel && 'flex-1')}
          onClick={onPrimary}
          disabled={status === 'installing'}
        >
          {status === 'installing' ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('updates.action.installing')}
            </span>
          ) : (
            primaryLabel
          )}
        </button>
      </div>
    </div>
  );

  let content: ReactNode = null;

  switch (status) {
    case 'available':
      content = renderAvailableCard();
      break;
    case 'downloading':
      content = renderDownloadingCard();
      break;
    case 'downloaded':
      content = renderCompactCard(
        autoInstallCountdown != null && autoInstallCountdown >= 0
          ? t('updates.status.autoInstalling', { seconds: autoInstallCountdown })
          : t('updates.status.downloaded', { version }),
        t('updates.action.install'),
        () => void installUpdate(),
        autoInstallCountdown != null && autoInstallCountdown >= 0
          ? t('updates.action.cancelAutoInstall')
          : undefined,
        autoInstallCountdown != null && autoInstallCountdown >= 0
          ? () => void cancelAutoInstall()
          : undefined,
      );
      break;
    case 'installing':
      content = renderCompactCard(
        t('updates.status.installing'),
        t('updates.action.installing'),
        () => {},
      );
      break;
    case 'installed':
      content = renderCompactCard(
        restartCountdown != null && restartCountdown >= 0
          ? t('updates.status.restartingIn', { seconds: restartCountdown })
          : t('updates.status.installed', { version }),
        t('updates.action.restartNow'),
        () => void restartApp(),
        restartCountdown != null && restartCountdown >= 0
          ? t('updates.action.cancelRestart')
          : undefined,
        restartCountdown != null && restartCountdown >= 0
          ? () => void cancelRestartCountdown()
          : undefined,
      );
      break;
    case 'error':
      content = renderCompactCard(
        error || t('updates.status.failed'),
        t('updates.action.retry'),
        () => void handleRetry(),
      );
      break;
    default:
      content = null;
  }

  if (!content) return null;

  return (
    <>
      <div className="shrink-0 bg-[var(--sto-sidebar-bg)] px-2 pt-2">{content}</div>
      <UpdateContentModal
        open={modalOpen}
        version={updateInfo?.version}
        title={updateInfo?.title}
        releaseNotes={updateInfo?.releaseNotes}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}

export default SidebarUpdateNotice;
