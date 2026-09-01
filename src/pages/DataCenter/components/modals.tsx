import { useEffect, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, ChevronRight, CircleAlert, Loader2, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import directoryIcon from '@/assets/icons/directory.svg';
import downloadIcon from '@/assets/icons/download-icon.svg?raw';
import shareIcon from '@/assets/icons/share-icon.svg?raw';
import uploadIcon from '@/assets/icons/upload-icon.svg?raw';
import { ThemedMonochromeIcon } from '@/components/icons/themed-monochrome-icon';
import { FilePreviewViewer } from '@/components/file-preview/FilePreviewViewer';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { listDataCenterEntries } from '@/lib/data-center-api';
import { cn } from '@/lib/utils';
import type { DataCenterEntry, DataCenterSpaceType, DataCenterTempUrl } from '@/types/data-center';
import { actionTooltipClass, ROOT_ENTRY_ID } from '../constants';
import type { DataCenterUiEntry } from '../types';

export function DataCenterModal({
  title,
  children,
  onClose,
  footer,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const { t } = useTranslation('common');
  return (
    <div className="sto-overlay-scrim sto-overlay-scrim--dialog fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className={cn(
        'sto-overlay sto-overlay--dialog flex max-h-[86vh] w-full flex-col overflow-hidden rounded-[var(--sto-dialog-radius)] border',
        wide ? 'max-w-5xl' : 'max-w-md',
      )}>
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="sto-control sto-dialog-close rounded-md p-1"
            aria-label={t('actions.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
        {footer ? <div className="sto-dialog-footer shrink-0 border-t border-border px-5 py-4">{footer}</div> : null}
      </div>
    </div>
  );
}

export function TraceChatMissingDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('common');
  return (
    <div className="sto-overlay-scrim sto-overlay-scrim--dialog fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="sto-overlay sto-overlay--dialog w-full max-w-[337px] overflow-hidden rounded-[var(--sto-dialog-radius)] border">
        <div className="flex items-start gap-3 px-4 pb-4 pt-[17px]">
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 fill-[#FFB21A] text-white" />
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold leading-5 text-[#1D2129] dark:text-foreground">
              {t('dataCenterPage.dialogs.traceMissingTitle')}
            </h2>
            <p className="mt-2 text-[13px] leading-5 text-[#6B778C] dark:text-muted-foreground">
              {t('dataCenterPage.dialogs.traceMissingMessage')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 -mt-1 rounded-md p-1 text-[#4E5969] hover:bg-[#F2F3F5] hover:text-[#1D2129] dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground"
            aria-label={t('actions.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex justify-end px-4 pb-4">
          <Button
            type="button"
            onClick={onClose}
            className="h-8 rounded-[10px] bg-[#1D2129] px-4 text-[13px] font-medium text-white shadow-none hover:bg-[#343A45] dark:bg-[var(--sto-dialog-action-background)] dark:text-[var(--sto-dialog-action-foreground)] dark:hover:bg-[var(--sto-dialog-action-hover-background)]"
          >
            {t('actions.gotIt')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function TextPromptModal({
  title,
  label,
  initialValue = '',
  confirmText,
  onCancel,
  onConfirm,
}: {
  title: string;
  label: string;
  initialValue?: string;
  confirmText?: string;
  onCancel: () => void;
  onConfirm: (value: string) => Promise<void> | void;
}) {
  const { t } = useTranslation('common');
  const effectiveConfirmText = confirmText ?? t('actions.confirm');
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      toast.error(t('dataCenterPage.toasts.nameRequired'));
      return;
    }
    setSaving(true);
    try {
      await onConfirm(trimmed);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sto-overlay-scrim sto-overlay-scrim--dialog fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="sto-overlay sto-overlay--dialog w-full max-w-[454px] overflow-hidden rounded-[var(--sto-dialog-radius)] border">
        <div className="flex h-[50px] items-center justify-between border-b border-[#E5E6EB] px-[18px] dark:border-border">
          <h2 className="text-[18px] font-semibold leading-[24px] text-[#1D2129] dark:text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-6 w-6 items-center justify-center rounded text-[#1D2129] hover:bg-[#F2F3F5] dark:text-foreground dark:hover:bg-muted"
            aria-label={t('actions.close')}
          >
            <X className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>

        <div className="px-[18px] py-[18px]">
          <label className="sr-only">{label}</label>
          <div className="relative">
            <textarea
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={label}
              className="h-[68px] w-full resize-none rounded-[6px] border border-[#C9CDD4] bg-white px-2 py-2 text-[14px] font-medium leading-5 text-[#1D2129] outline-none placeholder:text-[#C9CDD4] focus:border-[#A8B0BD] dark:border-border dark:bg-background dark:text-foreground dark:placeholder:text-muted-foreground"
              autoFocus
            />
          </div>
        </div>

        <div className="sto-dialog-footer h-[64px] items-center border-t border-[#E5E6EB] px-[18px] dark:border-border">
          <Button type="button" variant="outline" className="h-9 rounded-[14px] px-5 text-[14px] font-normal" onClick={onCancel}>
            {t('actions.cancel')}
          </Button>
          <Button type="button" className="h-9 rounded-[14px] bg-[#1D2129] px-5 text-[14px] font-normal text-white hover:bg-[#4E5969] dark:bg-[var(--sto-dialog-action-background)] dark:text-[var(--sto-dialog-action-foreground)] dark:hover:bg-[var(--sto-dialog-action-hover-background)]" onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {effectiveConfirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function PreviewModal({
  entry,
  tempUrl,
  onClose,
  onRefresh,
  onDownload,
  onShare,
  onUploadToShared,
  allowUploadToShared = true,
}: {
  entry: DataCenterUiEntry;
  tempUrl: DataCenterTempUrl;
  onClose: () => void;
  onRefresh: () => Promise<void> | void;
  onDownload: () => void;
  onShare?: () => void;
  onUploadToShared?: () => void;
  allowUploadToShared?: boolean;
}) {
  const { t } = useTranslation('common');
  const [refreshing, setRefreshing] = useState(false);
  const canDownload = !entry.localAuthorized;
  const canUploadToShared = allowUploadToShared && entry.entryType === 'file' && entry.spaceType === 'qa_artifact' && !entry.localAuthorized;

  const refreshPreview = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="sto-overlay-scrim sto-overlay-scrim--dialog no-drag fixed inset-0 z-50 flex items-center justify-center overflow-auto px-6 py-[30px]">
      <div className="no-drag flex h-[calc(100vh-60px)] max-h-[calc(100vh-60px)] w-[80vw] min-w-[500px] max-w-[min(1000px,calc(100vw-48px))] flex-col overflow-hidden rounded-[6px] border border-[#D7DBE2] bg-white shadow-[0_18px_48px_rgba(15,23,42,0.24)] dark:border-foreground/15 dark:bg-background dark:shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_24px_72px_rgba(0,0,0,0.62)]">
        <div className="no-drag relative z-10 flex h-[46px] shrink-0 items-center border-b border-[#E5E6EB] bg-white px-3 dark:border-border dark:bg-background">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold leading-4 text-[#1D2129] dark:text-foreground">
              {entry.name}
            </p>
          </div>
          <div className="no-drag flex shrink-0 items-center gap-1 self-stretch pl-3">
            <PreviewHeaderActionButton onClick={() => void refreshPreview()} ariaLabel={t('actions.refresh')} disabled={refreshing}>
              {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
            </PreviewHeaderActionButton>
            {canDownload ? (
              <PreviewHeaderActionButton onClick={onDownload} ariaLabel={t('dataCenterPage.menu.download')}>
                <ThemedMonochromeIcon source={downloadIcon} className="h-3.5 w-3.5" />
              </PreviewHeaderActionButton>
            ) : null}
            {onShare ? (
              <PreviewHeaderActionButton onClick={onShare} ariaLabel={t('dataCenterPage.menu.share')}>
                <ThemedMonochromeIcon source={shareIcon} className="h-3.5 w-3.5" />
              </PreviewHeaderActionButton>
            ) : null}
            {canUploadToShared && onUploadToShared ? (
              <PreviewHeaderActionButton onClick={onUploadToShared} ariaLabel={t('dataCenterPage.menu.uploadToShared')}>
                <ThemedMonochromeIcon source={uploadIcon} className="h-3.5 w-3.5" />
              </PreviewHeaderActionButton>
            ) : null}
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onClose();
              }}
              className="no-drag ml-1 flex h-6 w-6 items-center justify-center rounded text-[#1D2129] transition-colors hover:bg-[#F2F3F5] dark:text-foreground dark:hover:bg-muted"
              aria-label={t('actions.close')}
              title={t('actions.close')}
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        </div>
        <div className="no-drag min-h-0 flex-1 overflow-hidden bg-white dark:bg-background">
          <FilePreviewViewer
            filePath={tempUrl.tempUrl}
            fileName={tempUrl.fileName || entry.name}
            mimeType={tempUrl.mimeType || entry.mimeType || 'application/octet-stream'}
            className="h-full w-full"
          />
        </div>
      </div>
    </div>
  );
}

function PreviewHeaderActionButton({
  children,
  ariaLabel,
  onClick,
  disabled = false,
}: {
  children: ReactNode;
  ariaLabel: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
            event.preventDefault();
            event.stopPropagation();
            onClick();
          }}
          className="no-drag flex h-6 w-6 items-center justify-center rounded text-[#4E5969] transition-colors hover:bg-[#F2F3F5] hover:text-[#1D2129] disabled:cursor-wait disabled:opacity-60 dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground"
          disabled={disabled}
          aria-label={ariaLabel}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className={actionTooltipClass}>
        {ariaLabel}
      </TooltipContent>
    </Tooltip>
  );
}

type SharedFolderMap = Record<string, DataCenterEntry[]>;
type SharedFolderLoadingMap = Record<string, boolean>;
type SharedFolderOpenMap = Record<string, boolean>;

export function UploadToSharedFolderDialog({
  entry,
  targetSpaceId,
  onClose,
  onConfirm,
}: {
  entry: DataCenterUiEntry;
  targetSpaceId: string;
  onClose: () => void;
  onConfirm: (targetParentEntryId: string) => Promise<void>;
}) {
  const { t } = useTranslation('common');
  return (
    <FolderPickerDialog
      title={t('dataCenterPage.dialogs.uploadToSharedTitle')}
      message={t('dataCenterPage.dialogs.uploadToSharedMessage', { name: entry.name })}
      rootLabel={t('dataCenterPage.saveArtifact.sharedArtifacts')}
      spaceType="site_shared_artifact"
      spaceId={targetSpaceId}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}

export function MoveEntryDialog({
  entry,
  onClose,
  onConfirm,
}: {
  entry: DataCenterUiEntry;
  onClose: () => void;
  onConfirm: (targetParentEntryId: string) => Promise<void>;
}) {
  const { t } = useTranslation('common');
  const rootLabel = entry.spaceType === 'site_shared_artifact'
    ? t('dataCenterPage.saveArtifact.sharedArtifacts')
    : entry.spaceType === 'drive'
      ? t('dataCenterPage.tabs.uploadFiles')
      : t('dataCenterPage.saveArtifact.myArtifacts');
  const disabledEntryIds = entry.entryType === 'folder' ? new Set([entry.entryId]) : undefined;
  return (
    <FolderPickerDialog
      title={t('dataCenterPage.dialogs.moveToTitle')}
      message={t('dataCenterPage.dialogs.moveToMessage', { name: entry.name })}
      rootLabel={rootLabel}
      spaceType={entry.spaceType}
      spaceId={entry.spaceId ?? undefined}
      disabledEntryIds={disabledEntryIds}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}

function FolderPickerDialog({
  title,
  message,
  rootLabel,
  spaceType,
  spaceId,
  disableSharedFolders = false,
  disabledEntryIds,
  onClose,
  onConfirm,
}: {
  title: string;
  message: string;
  rootLabel: string;
  spaceType: DataCenterSpaceType;
  spaceId?: string;
  disableSharedFolders?: boolean;
  disabledEntryIds?: Set<string>;
  onClose: () => void;
  onConfirm: (targetParentEntryId: string) => Promise<void>;
}) {
  const { t } = useTranslation('common');
  const [selectedEntryId, setSelectedEntryId] = useState(ROOT_ENTRY_ID);
  const [folderMap, setFolderMap] = useState<SharedFolderMap>({});
  const [loadingMap, setLoadingMap] = useState<SharedFolderLoadingMap>({});
  const [openMap, setOpenMap] = useState<SharedFolderOpenMap>({ [ROOT_ENTRY_ID]: true });
  const [saving, setSaving] = useState(false);

  const fetchFolders = async (parentEntryId: string) => {
    const result = await listDataCenterEntries({
      spaceType,
      spaceId,
      parentEntryId,
      entryType: 'folder',
      pageSize: 200,
      sortField: 'name',
      sortOrder: 'asc',
    });
    return result.items.filter((item) => item.entryType === 'folder');
  };

  const loadFolders = async (parentEntryId: string, options: { preloadChildFolders?: boolean } = {}) => {
    setLoadingMap((prev) => ({ ...prev, [parentEntryId]: true }));
    try {
      const folders = await fetchFolders(parentEntryId);
      setFolderMap((prev) => ({
        ...prev,
        [parentEntryId]: folders,
      }));
      if (options.preloadChildFolders && folders.length > 0) {
        setLoadingMap((prev) => ({
          ...prev,
          ...Object.fromEntries(folders.map((folder) => [folder.entryId, true])),
        }));
        const childResults = await Promise.all(
          folders.map(async (folder) => {
            try {
              return { entryId: folder.entryId, folders: await fetchFolders(folder.entryId) };
            } catch {
              return { entryId: folder.entryId, folders: null };
            }
          }),
        );
        setFolderMap((prev) => {
          const next = { ...prev };
          for (const childResult of childResults) {
            if (childResult.folders !== null) next[childResult.entryId] = childResult.folders;
          }
          return next;
        });
        setLoadingMap((prev) => ({
          ...prev,
          ...Object.fromEntries(folders.map((folder) => [folder.entryId, false])),
        }));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('dataCenterPage.saveArtifact.loadFoldersFailed'));
      setFolderMap((prev) => ({ ...prev, [parentEntryId]: [] }));
    } finally {
      setLoadingMap((prev) => ({ ...prev, [parentEntryId]: false }));
    }
  };

  const toggleFolder = async (folderId: string) => {
    const nextOpen = !openMap[folderId];
    setOpenMap((prev) => ({ ...prev, [folderId]: nextOpen }));
    const childFolders = folderMap[folderId];
    const needsChildPreload = childFolders === undefined
      || childFolders.some((folder) => folderMap[folder.entryId] === undefined);
    if (nextOpen && needsChildPreload) {
      await loadFolders(folderId, { preloadChildFolders: true });
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadFolders(ROOT_ENTRY_ID, { preloadChildFolders: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceType, spaceId]);

  const submit = async () => {
    setSaving(true);
    try {
      await onConfirm(selectedEntryId);
    } finally {
      setSaving(false);
    }
  };

  const rootFolders = folderMap[ROOT_ENTRY_ID] ?? [];
  const rootLoading = Boolean(loadingMap[ROOT_ENTRY_ID]);

  return (
    <div className="sto-overlay-scrim sto-overlay-scrim--dialog fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="sto-overlay sto-overlay--dialog w-full max-w-[414px] overflow-hidden rounded-[var(--sto-dialog-radius)] border">
        <div className="flex h-11 items-center justify-between px-4">
          <h2 className="text-[13px] font-semibold text-[#1D2129] dark:text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[#4E5969] hover:bg-[#F2F3F5] hover:text-[#1D2129] dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground"
            aria-label={t('actions.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-3 pb-3">
          <p className="text-[13px] leading-5 text-[#4E5969] dark:text-muted-foreground">{message}</p>
          <div className="mt-3 rounded-[14px] bg-[#F7F8FA] p-2 dark:bg-muted/40">
            <div className="rounded-[10px] bg-white p-2.5 dark:bg-card">
              <FolderPickerRow
                folderId={ROOT_ENTRY_ID}
                label={rootLabel}
                selectedEntryId={selectedEntryId}
                open={openMap[ROOT_ENTRY_ID] ?? true}
                loading={rootLoading}
                childrenFolders={rootFolders}
                folderMap={folderMap}
                loadingMap={loadingMap}
                openMap={openMap}
                disableSharedFolders={disableSharedFolders}
                disabledEntryIds={disabledEntryIds}
                onSelect={setSelectedEntryId}
                onToggle={toggleFolder}
                root
              />
            </div>
          </div>
        </div>

        <div className="sto-dialog-footer h-[48px] border-t border-[#E5E6EB] px-3 py-2 dark:border-border">
          <Button type="button" variant="outline" className="h-8 rounded-[8px] px-4 text-[12px] font-normal" onClick={onClose}>{t('actions.cancel')}</Button>
          <Button type="button" className="h-8 rounded-[8px] bg-[#1D2129] px-4 text-[12px] font-normal text-white hover:bg-[#4E5969] dark:bg-[var(--sto-dialog-action-background)] dark:text-[var(--sto-dialog-action-foreground)] dark:hover:bg-[var(--sto-dialog-action-hover-background)]" onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            {t('actions.confirm')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function FolderPickerCheckbox({
  checked,
  disabled = false,
  onClick,
}: {
  checked: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border text-white transition-colors',
        checked
          ? 'border-[#1D2129] bg-[#1D2129] dark:border-primary dark:bg-primary'
          : 'border-[#D7DBE2] bg-white dark:border-border dark:bg-background',
        disabled && 'cursor-not-allowed opacity-45',
      )}
      aria-pressed={checked}
    >
      {checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
    </button>
  );
}

function FolderPickerRow({
  folderId,
  label,
  selectedEntryId,
  open,
  loading,
  childrenFolders,
  folderMap,
  loadingMap,
  openMap,
  disabled,
  disableSharedFolders,
  disabledEntryIds,
  onSelect,
  onToggle,
  depth = 0,
  root = false,
}: {
  folderId: string;
  label: string;
  selectedEntryId: string;
  open: boolean;
  loading: boolean;
  childrenFolders: DataCenterEntry[];
  folderMap: SharedFolderMap;
  loadingMap: SharedFolderLoadingMap;
  openMap: SharedFolderOpenMap;
  disabled?: boolean;
  disableSharedFolders?: boolean;
  disabledEntryIds?: Set<string>;
  onSelect: (entryId: string) => void;
  onToggle: (entryId: string) => void;
  depth?: number;
  root?: boolean;
}) {
  const selected = selectedEntryId === folderId;
  const rowDisabled = disabled || disabledEntryIds?.has(folderId) || false;
  const childrenLoaded = folderMap[folderId] !== undefined;
  const showToggle = loading || !childrenLoaded || childrenFolders.length > 0;
  return (
    <div className="space-y-1">
      <div
        className={cn(
          'flex h-7 w-full items-center gap-[10px] rounded-[6px] text-left hover:bg-[#F7F8FA] dark:hover:bg-muted/50',
          rowDisabled && 'opacity-50',
        )}
        style={root ? undefined : { paddingLeft: depth * 27 }}
      >
        <FolderPickerCheckbox checked={selected} disabled={rowDisabled} onClick={() => onSelect(folderId)} />
        {showToggle ? (
          <button
            type="button"
            onClick={() => onToggle(folderId)}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[#4E5969] hover:bg-[#F2F3F5] dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground"
            aria-label={label}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : null}
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-[10px] rounded-[6px] text-left disabled:cursor-not-allowed"
          onClick={() => onSelect(folderId)}
          disabled={rowDisabled}
        >
          <img src={directoryIcon} alt="" aria-hidden="true" className="h-5 w-5 shrink-0 object-contain dark:brightness-110" />
          <span className={cn('min-w-0 flex-1 truncate font-semibold text-[#1D2129] dark:text-foreground', root ? 'text-[13px]' : 'text-[12px]')}>{label}</span>
        </button>
      </div>
      {open && childrenFolders.length > 0 ? (
        <div className={cn('space-y-1', root && 'pl-[27px]')}>
          {childrenFolders.map((folder) => (
            <FolderPickerRow
              key={folder.entryId}
              folderId={folder.entryId}
              label={folder.name}
              selectedEntryId={selectedEntryId}
              open={Boolean(openMap[folder.entryId])}
              loading={Boolean(loadingMap[folder.entryId])}
              childrenFolders={folderMap[folder.entryId] ?? []}
              folderMap={folderMap}
              loadingMap={loadingMap}
              openMap={openMap}
              disabled={rowDisabled || (disableSharedFolders && folder.shared === true)}
              disableSharedFolders={disableSharedFolders}
              disabledEntryIds={disabledEntryIds}
              onSelect={onSelect}
              onToggle={onToggle}
              depth={root ? 0 : depth + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
