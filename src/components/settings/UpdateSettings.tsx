/**
 * Update Settings — version card, toggles, status actions, and download progress (MasterGo layout).
 */
import { useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { useUpdateStore } from '@/stores/update';
import { useSettingsStore } from '@/stores/settings';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { UpdateDownloadProgress } from './update/UpdateDownloadProgress';
import { updateDividerInsetLineClass } from './update/updateDivider';
import type { UpdateStatus } from '@/stores/update';
import { Button } from '@/components/ui/button';
import { settingsPrimaryActionButtonClass } from '@/lib/surfaces';

/** 有待处理更新时显示橙色标签 */
const UPDATE_PENDING_BADGE_STATUSES: UpdateStatus[] = [
  'available',
  'downloading',
  'downloaded',
  'installing',
];

const updateSettingsSwitchClass =
  'data-[state=checked]:bg-[#00B42A] dark:data-[state=checked]:bg-[#00B42A]';

const updateAvailableBadgeClass = cn(
  'inline-flex shrink-0 items-center justify-center',
  'h-[26px] rounded-[8px] px-2 py-1.5',
  'bg-[#FFF1E8] text-[12px] font-normal leading-none text-[var(--sto-brand-6)]',
  'whitespace-nowrap',
);

const updateLatestBadgeClass = cn(
  'inline-flex shrink-0 items-center justify-center',
  'h-[26px] min-w-[40px] rounded-[8px] px-2 py-1.5',
  'bg-[#E7F3EB] text-[12px] font-normal leading-none text-[#00B42A]',
  'whitespace-nowrap',
);

const updatePrimaryBtnClass = cn(settingsPrimaryActionButtonClass, 'shrink-0 whitespace-nowrap');

/** MasterGo：禁用态（检查中）— 浅灰底 */
const updateDisabledBtnClass = cn(
  'inline-flex h-9 shrink-0 items-center justify-center rounded-[12px] px-5',
  'text-[14px] font-medium leading-none whitespace-nowrap',
  'bg-[#F2F3F5] text-[#86909C] cursor-not-allowed',
  'dark:bg-muted dark:text-muted-foreground',
);

/** MasterGo：下载中 / 安装中 — 深灰底白字 */
const updateInProgressBtnClass = cn(
  'inline-flex h-9 shrink-0 items-center justify-center rounded-[12px] px-5',
  'text-[14px] font-medium leading-none whitespace-nowrap',
  'cursor-not-allowed bg-[#86909C] text-white',
  'dark:bg-muted-foreground dark:text-white',
);

export function UpdateSettings() {
  const { t } = useTranslation('settings');
  const {
    autoCheckUpdate,
    setAutoCheckUpdate,
    autoDownloadUpdate,
    setAutoDownloadUpdate,
  } = useSettingsStore();
  const {
    status,
    currentVersion,
    updateInfo,
    progress,
    error,
    isInitialized,
    autoInstallCountdown,
    restartCountdown,
    init,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    restartApp,
    cancelRestartCountdown,
    cancelAutoInstall,
    clearError,
    setAutoDownload,
  } = useUpdateStore();

  useEffect(() => {
    init();
  }, [init]);

  const handleCheckForUpdates = useCallback(async () => {
    clearError();
    await checkForUpdates();
  }, [checkForUpdates, clearError]);

  const renderAction = () => {
    switch (status) {
      case 'checking':
        return (
          <button type="button" disabled className={updateDisabledBtnClass}>
            {t('updates.action.checking')}
          </button>
        );
      case 'downloading':
        return (
          <button type="button" disabled className={updateInProgressBtnClass}>
            {t('updates.action.downloading')}
          </button>
        );
      case 'available':
        return (
          <Button type="button" className={updatePrimaryBtnClass} onClick={() => void downloadUpdate()}>
            {t('updates.action.downloadNewVersion')}
          </Button>
        );
      case 'downloaded':
        if (autoInstallCountdown != null && autoInstallCountdown >= 0) {
          return (
            <div className="flex shrink-0 gap-2">
              <button type="button" className={updateDisabledBtnClass} onClick={() => void cancelAutoInstall()}>
                {t('updates.action.cancelAutoInstall')}
              </button>
              <Button type="button" className={updatePrimaryBtnClass} onClick={() => void installUpdate()}>
                {t('updates.action.install')}
              </Button>
            </div>
          );
        }
        return (
          <Button type="button" className={updatePrimaryBtnClass} onClick={() => void installUpdate()}>
            {t('updates.action.install')}
          </Button>
        );
      case 'installing':
        return (
          <button type="button" disabled className={updateInProgressBtnClass}>
            {t('updates.action.installing')}
          </button>
        );
      case 'installed':
        if (restartCountdown != null && restartCountdown >= 0) {
          return (
            <div className="flex shrink-0 gap-2">
              <button type="button" className={updateDisabledBtnClass} onClick={() => cancelRestartCountdown()}>
                {t('updates.action.cancelRestart')}
              </button>
              <Button type="button" className={updatePrimaryBtnClass} onClick={() => restartApp()}>
                {t('updates.action.restartNow')}
              </Button>
            </div>
          );
        }
        return (
          <Button type="button" className={updatePrimaryBtnClass} onClick={() => restartApp()}>
            {t('updates.action.restart')}
          </Button>
        );
      case 'error':
        return (
          <Button type="button" className={updatePrimaryBtnClass} onClick={() => void handleCheckForUpdates()}>
            {t('updates.action.retry')}
          </Button>
        );
      default:
        return (
          <Button type="button" className={updatePrimaryBtnClass} onClick={() => void handleCheckForUpdates()}>
            {t('updates.action.check')}
          </Button>
        );
    }
  };

  if (!isInitialized) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{t('updates.loading')}</span>
      </div>
    );
  }

  const downloadingVersion = updateInfo?.version;
  const showProgress = status === 'downloading' && progress;
  const showUpdateAvailableBadge = UPDATE_PENDING_BADGE_STATUSES.includes(status);
  const showLatestBadge = status === 'not-available';

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-[8px] border border-[#E5E6EB] bg-white dark:border-border dark:bg-card">
        <div className="flex items-center justify-between gap-4 px-5 py-5">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="text-[15px] leading-snug text-[#1D2129] dark:text-foreground">
                <span className="font-bold">{t('updates.currentVersionLabel')}</span>
                <span className="font-normal"> v{currentVersion}</span>
              </p>
              {showUpdateAvailableBadge ? (
                <span className={updateAvailableBadgeClass}>
                  {t('updates.sidebar.newVersionTitle')}
                </span>
              ) : showLatestBadge ? (
                <span className={updateLatestBadgeClass}>
                  {t('updates.latestBadge')}
                </span>
              ) : null}
            </div>
            <p className="text-[13px] font-normal leading-relaxed text-[#86909C] dark:text-muted-foreground">
              {t('updates.cardHint')}
            </p>
            {status === 'installing' ? (
              <p className="text-[13px] font-normal text-[#1D2129] dark:text-foreground">
                {t('updates.status.installing')}
              </p>
            ) : null}
          </div>
          <div className="shrink-0 self-center">{renderAction()}</div>
        </div>

        {showProgress ? (
          <div className="px-5 pb-5">
            <p className="mb-3 text-[13px] font-bold text-[#1D2129] dark:text-foreground">
              {t('updates.downloadingLabel', { version: downloadingVersion })}
            </p>
            <UpdateDownloadProgress progress={progress} />
          </div>
        ) : null}

        <div className={updateDividerInsetLineClass} aria-hidden="true" />

        <div className="flex items-center justify-between gap-4 px-5 py-5">
          <div className="min-w-0">
            <Label className="text-[15px] font-bold text-[#1D2129] dark:text-foreground">
              {t('updates.autoCheck')}
            </Label>
            <p className="mt-1 text-[13px] font-normal text-[#86909C] dark:text-muted-foreground">
              {t('updates.autoCheckDesc')}
            </p>
          </div>
          <Switch
            checked={autoCheckUpdate}
            onCheckedChange={setAutoCheckUpdate}
            className={updateSettingsSwitchClass}
          />
        </div>

        <div className="flex items-center justify-between gap-4 px-5 py-5">
          <div className="min-w-0">
            <Label className="text-[15px] font-bold text-[#1D2129] dark:text-foreground">
              {t('updates.autoDownload')}
            </Label>
            <p className="mt-1 text-[13px] font-normal text-[#86909C] dark:text-muted-foreground">
              {t('updates.autoDownloadDesc')}
            </p>
          </div>
          <Switch
            checked={autoDownloadUpdate}
            onCheckedChange={(value) => {
              setAutoDownloadUpdate(value);
              setAutoDownload(value);
            }}
            className={updateSettingsSwitchClass}
          />
        </div>
      </div>

      {status === 'error' && error ? (
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-600 dark:bg-red-900/10 dark:text-red-400">
          <p className="mb-1 font-medium">{t('updates.errorDetails')}</p>
          <p className="whitespace-pre-wrap">{error}</p>
        </div>
      ) : null}
    </div>
  );
}

export default UpdateSettings;
