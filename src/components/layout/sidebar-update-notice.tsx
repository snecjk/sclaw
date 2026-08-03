import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Progress } from '@/components/ui/progress';
import { UpdateDownloadProgress } from '@/components/settings/update/UpdateDownloadProgress';
import type { ProgressInfo } from '@/stores/update';
import { Tooltip, TooltipArrow, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useUpdateStore } from '@/stores/update';
import { cn } from '@/lib/utils';
import { dismissUpdate, isUpdateDismissed } from '@/lib/update-dismiss-storage';
import { UpdateContentModal } from './update-content-modal';

const SIDEBAR_TOOLTIP_CLASS = cn(
  'overflow-visible rounded-lg border-0 bg-[#1D2129] px-2.5 py-1.5 text-xs font-medium text-white',
  'shadow-[0_6px_20px_rgba(0,0,0,0.16)]',
  'dark:bg-[#2E3038] dark:text-white dark:shadow-[0_8px_24px_rgba(0,0,0,0.4)]',
);
const SIDEBAR_TOOLTIP_ARROW_CLASS = 'fill-[#1D2129] dark:fill-[#2E3038]';

interface SidebarUpdateNoticeProps {
  collapsed: boolean;
}

/*
 * DEV UI PREVIEW — 侧边栏更新卡片 UI 联调（发版前请保持关闭）
 * 下次开启：
 * 1. 取消下方 UI_PREVIEW_ENABLED / UI_PREVIEW_VERSION / PreviewUiStatus 的注释
 * 2. 取消本文件内「preview state / effect / isPreviewOnly 分支」的块注释
 * 3. 可选：.env 设置 VITE_SIDEBAR_UPDATE_NOTICE_PREVIEW=1（dev 默认即为 1）
 */
// const UI_PREVIEW_ENABLED =
//   import.meta.env.DEV && String(import.meta.env.VITE_SIDEBAR_UPDATE_NOTICE_PREVIEW ?? '1') !== '0';
// const UI_PREVIEW_VERSION = '2026.6.15-GA.2';
// type PreviewUiStatus = 'available' | 'downloading' | 'dismissed';

const VISIBLE_STATUSES = new Set([
  'available',
  'downloading',
  'downloaded',
  'installing',
  'installed',
  'error',
]);

/** MasterGo 标注：卡片内边距 12、图标 40×40、图标与文案间距 8 */
const UPDATE_CARD_PADDING_PX = 12;
const UPDATE_ICON_BOX_PX = 40;
const UPDATE_ICON_GAP_PX = 8;
/** 按钮行左缘与标题对齐：图标宽 + 间距 */
const UPDATE_BTN_ROW_INDENT = UPDATE_ICON_BOX_PX + UPDATE_ICON_GAP_PX;

/** MasterGo 导出：侧边栏更新同步图标 */
function UpdateSyncGlyph({ spinning = false, className }: { spinning?: boolean; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 14 14"
      fill="none"
      className={cn('size-[14px] shrink-0', spinning && 'animate-spin', className)}
      aria-hidden
    >
      <path
        d="M9.8411503,1.5065125L9.8222752,1.5261875L7.9464126,3.40205C7.7023377,3.6461251,7.3066001,3.6461251,7.0625248,3.40205C6.82585,3.165375,6.818675,2.7860875,7.0410123,2.5407624L7.0625248,2.5181749L8.2043743,1.3762499L8.1425991,1.3633875C7.7986493,1.2940999,7.4465365,1.2561125,7.0893865,1.250675L6.999999,1.25C3.8243616,1.25,1.2499967,3.8243625,1.2499967,7C1.2499967,7.7457623,1.3917117,8.4708004,1.6639867,9.1468372C1.7929367,9.4670248,1.6379242,9.8311243,1.3177366,9.9600868C0.99754786,10.089037,0.63344789,9.9340115,0.50449288,9.6138239C0.17268413,8.7899742,-0.0000033974648,7.9064612,-0.0000033974648,6.999999C-0.0000033974648,3.1340115,3.1340117,-0.0000033378601,6.999999,-0.0000033378601C7.9064617,-0.0000033378601,8.7899742,0.17268416,9.6138239,0.50449294C10.020962,0.66846794,10.134499,1.1875705,9.8411503,1.5065125ZM7.0000248,14C6.0936623,14,5.2102375,13.827375,4.3864622,13.495625C3.9785998,13.331374,3.8655496,12.811,4.1603246,12.492287L4.179287,12.472636L6.1031246,10.559961C6.3478994,10.316586,6.7436371,10.317737,6.9869995,10.562524C7.2229872,10.799899,7.2290621,11.179199,7.006012,11.423874L6.9844246,11.446411L5.7993994,12.624498L5.8575368,12.636623C6.2014618,12.705873,6.5535369,12.743874,6.9106369,12.749373L7.0000243,12.749998C10.175662,12.749998,12.75,10.175635,12.75,6.9999981C12.75,6.254323,12.608375,5.5293608,12.336125,4.8533859C12.207188,4.5331984,12.362226,4.1690984,12.682375,4.0401611C13.002625,3.9112236,13.36675,4.0662613,13.495625,4.3864489C13.827374,5.2102237,14,6.0936365,14,6.999999C14,10.865999,10.866013,13.999999,7.0000248,14Z"
        fill="currentColor"
      />
    </svg>
  );
}

function SyncIcon({ spinning = false, className }: { spinning?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-[8px] bg-[#E7F3EB] text-[#1D2129]',
        className,
      )}
      style={{ width: UPDATE_ICON_BOX_PX, height: UPDATE_ICON_BOX_PX }}
    >
      <UpdateSyncGlyph spinning={spinning} />
    </span>
  );
}

/** 侧边栏更新卡片 — 对齐 MasterGo 稿 */
const updateCardClass = cn(
  'rounded-[12px] bg-white',
  'shadow-[0_2px_12px_rgba(15,23,42,0.06)]',
  'dark:border dark:border-[var(--sto-sidebar-border)] dark:bg-card dark:shadow-none',
);

const updateCardStyle = { padding: UPDATE_CARD_PADDING_PX } as const;

/** 按钮行与标题左缘对齐 */
const updateBtnRowClass = 'mt-3 flex items-center gap-2';

const updateBtnRowStyle = { paddingLeft: UPDATE_BTN_ROW_INDENT } as const;

const updatePrimaryBtnClass = cn(
  'inline-flex h-7 shrink-0 items-center justify-center rounded-[8px] border-0 px-3.5',
  'text-[12px] font-medium leading-none whitespace-nowrap',
  'bg-[#1D2129] text-white hover:bg-[#1D2129]/90',
  'disabled:cursor-not-allowed disabled:opacity-60',
  'dark:bg-foreground dark:text-background dark:hover:bg-foreground/90',
);

const updateSecondaryBtnClass = cn(
  'inline-flex h-7 shrink-0 items-center justify-center rounded-[8px] px-3.5',
  'border border-[#E5E6EB] bg-white text-[12px] font-medium leading-none whitespace-nowrap text-[#1D2129]',
  'hover:bg-[#FAFBFC]',
  'dark:border-[var(--sto-sidebar-border)] dark:bg-card dark:hover:bg-muted/40',
);

const updateViewBtnClass = cn(
  'inline-flex h-7 shrink-0 items-center justify-center rounded-[8px]',
  'border border-[#E5E6EB] bg-white px-3.5 text-[12px] font-medium leading-none whitespace-nowrap text-[#1D2129]',
  'hover:bg-[#FAFBFC]',
  'dark:border-[var(--sto-sidebar-border)] dark:bg-card dark:hover:bg-muted/40',
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
  // --- DEV preview state (uncomment with UI_PREVIEW_ENABLED) ---
  // const [previewUiStatus, setPreviewUiStatus] = useState<PreviewUiStatus>('available');
  // const [previewProgress, setPreviewProgress] = useState(12);
  // const [previewModalOpen, setPreviewModalOpen] = useState(false);

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

  // --- DEV preview progress tick (uncomment with UI_PREVIEW_ENABLED) ---
  // const isPreviewOnly = UI_PREVIEW_ENABLED && !shouldShow;
  // useEffect(() => {
  //   if (!isPreviewOnly || previewUiStatus !== 'downloading') return;
  //   const timer = window.setInterval(() => {
  //     setPreviewProgress((value) => (value >= 96 ? 12 : value + 8));
  //   }, 600);
  //   return () => window.clearInterval(timer);
  // }, [isPreviewOnly, previewUiStatus]);

  if (!shouldShow) return null;
  // if (isPreviewOnly && previewUiStatus === 'dismissed') return null;

  const displayVersion = version;
  const cardClass = updateCardClass;
  const effectivePercent = Math.round(progress?.percent ?? 0);

  type AvailableCardActions = {
    onUpdateNow: () => void;
    onLater: () => void;
  };

  const renderAvailableCard = (cardVersion: string, actions: AvailableCardActions) => (
    <div className={cardClass} style={updateCardStyle}>
      <div className="flex items-start" style={{ gap: UPDATE_ICON_GAP_PX }}>
        <SyncIcon />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-[18px] text-[#1D2129] dark:text-foreground">
            {t('updates.sidebar.newVersionTitle')}
          </p>
          <p className="mt-1 text-[12px] leading-[17px] text-[#86909C]">
            {t('updates.sidebar.updateToVersion', { version: cardVersion })}
          </p>
        </div>
      </div>
      <div className={updateBtnRowClass} style={updateBtnRowStyle}>
        <button
          type="button"
          className={updatePrimaryBtnClass}
          onClick={actions.onUpdateNow}
        >
          {t('updates.sidebar.updateNow')}
        </button>
        <button
          type="button"
          className={updateSecondaryBtnClass}
          onClick={actions.onLater}
        >
          {t('updates.sidebar.later')}
        </button>
      </div>
    </div>
  );

  const renderDownloadingCard = (
    percent: number,
    onViewUpdate: () => void,
    progressInfo?: ProgressInfo | null,
  ) => (
    <div className={cardClass} style={updateCardStyle}>
      <div className="flex items-start" style={{ gap: UPDATE_ICON_GAP_PX }}>
        <SyncIcon spinning />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-[18px] text-[#1D2129] dark:text-foreground">
            {t('updates.sidebar.updating')}
          </p>
          {progressInfo ? (
            <UpdateDownloadProgress progress={progressInfo} className="mt-2" compact />
          ) : (
            <div className="mt-2 flex items-center gap-1.5">
              <Progress
                value={percent}
                className="h-[5px] min-h-[5px] flex-1 overflow-hidden rounded-full bg-[#F0F2F5] [&>div]:rounded-full [&>div]:bg-[#00B54B]"
              />
              <span className="w-9 shrink-0 text-right text-[12px] font-normal tabular-nums leading-[17px] text-[#86909C]">
                {percent}%
              </span>
            </div>
          )}
          <button
            type="button"
            className={cn(updateViewBtnClass, 'mt-3')}
            onClick={onViewUpdate}
          >
            {t('updates.sidebar.viewUpdate')}
          </button>
        </div>
      </div>
    </div>
  );

  /*
  // --- DEV preview branch (uncomment with UI_PREVIEW_ENABLED + preview state above) ---
  if (isPreviewOnly) {
    const previewCollapsedLabel =
      previewUiStatus === 'downloading'
        ? t('updates.sidebar.updating')
        : t('updates.sidebar.newVersionTitle');

    const previewContent =
      previewUiStatus === 'downloading'
        ? renderDownloadingCard(effectivePercent, () => setPreviewModalOpen(true))
        : renderAvailableCard(displayVersion, {
            onUpdateNow: () => {
              setPreviewProgress(12);
              setPreviewUiStatus('downloading');
            },
            onLater: () => setPreviewUiStatus('dismissed'),
          });

    if (collapsed) {
      return (
        <>
          <div className="shrink-0 bg-[var(--sto-sidebar-bg)] px-3 pt-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="mx-auto flex items-center justify-center rounded-[8px] border border-[var(--sto-sidebar-border)] bg-[#E7F3EB] shadow-sm dark:bg-[#E7F3EB]"
                  style={{ width: UPDATE_ICON_BOX_PX, height: UPDATE_ICON_BOX_PX }}
                  aria-label={previewCollapsedLabel}
                  onClick={() => {
                    if (previewUiStatus === 'available') {
                      setPreviewProgress(12);
                      setPreviewUiStatus('downloading');
                    }
                  }}
                >
                  <UpdateSyncGlyph spinning={previewUiStatus === 'downloading'} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className={SIDEBAR_TOOLTIP_CLASS}>
                {previewCollapsedLabel}
                <TooltipArrow className={SIDEBAR_TOOLTIP_ARROW_CLASS} />
              </TooltipContent>
            </Tooltip>
          </div>
          <UpdateContentModal
            open={previewModalOpen}
            version={UI_PREVIEW_VERSION}
            onClose={() => setPreviewModalOpen(false)}
          />
        </>
      );
    }

    return (
      <>
        <div className="shrink-0 bg-[var(--sto-sidebar-bg)] px-3 pt-2">{previewContent}</div>
        <UpdateContentModal
          open={previewModalOpen}
          version={UI_PREVIEW_VERSION}
          onClose={() => setPreviewModalOpen(false)}
        />
      </>
    );
  }
  */

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
        <div className="shrink-0 bg-[var(--sto-sidebar-bg)] px-3 pt-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="mx-auto flex items-center justify-center rounded-[8px] border border-[var(--sto-sidebar-border)] bg-[#E7F3EB] shadow-sm dark:bg-[#E7F3EB]"
                style={{ width: UPDATE_ICON_BOX_PX, height: UPDATE_ICON_BOX_PX }}
                aria-label={collapsedLabel}
              >
                <UpdateSyncGlyph spinning={status === 'downloading' || status === 'installing'} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className={SIDEBAR_TOOLTIP_CLASS}>
              {collapsedLabel}
              <TooltipArrow className={SIDEBAR_TOOLTIP_ARROW_CLASS} />
            </TooltipContent>
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

  const renderCompactCard = (
    title: string,
    primaryLabel: string,
    onPrimary: () => void,
    secondaryLabel?: string,
    onSecondary?: () => void,
  ) => (
    <div className={cardClass} style={updateCardStyle}>
      <div className="flex items-start" style={{ gap: UPDATE_ICON_GAP_PX }}>
        <SyncIcon spinning={status === 'installing'} />
        <p className="min-w-0 flex-1 text-[13px] font-semibold leading-[18px] text-[#1D2129] dark:text-foreground">
          {title}
        </p>
      </div>
      <div className={updateBtnRowClass} style={updateBtnRowStyle}>
        {secondaryLabel && onSecondary ? (
          <button type="button" className={updateSecondaryBtnClass} onClick={onSecondary}>
            {secondaryLabel}
          </button>
        ) : null}
        <button
          type="button"
          className={updatePrimaryBtnClass}
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
      content = renderAvailableCard(displayVersion, {
        onUpdateNow: () => void downloadUpdate(),
        onLater: handleDismiss,
      });
      break;
    case 'downloading':
      content = renderDownloadingCard(effectivePercent, () => setModalOpen(true), progress);
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
      <div className="shrink-0 bg-[var(--sto-sidebar-bg)] px-3 pt-2">{content}</div>
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
