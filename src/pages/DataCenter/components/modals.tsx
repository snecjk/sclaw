import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, CircleAlert, Download, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import directoryIcon from '@/assets/icons/directory.svg';
import { FilePreviewViewer } from '@/components/file-preview/FilePreviewViewer';
import { Button } from '@/components/ui/button';
import { listDataCenterEntries } from '@/lib/data-center-api';
import { cn } from '@/lib/utils';
import type { DataCenterEntry, DataCenterTempUrl } from '@/types/data-center';
import { FOLDER_NAME_MAX_LENGTH, ROOT_ENTRY_ID } from '../constants';
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
      <div className={cn(
        'flex max-h-[86vh] w-full flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl',
        wide ? 'max-w-5xl' : 'max-w-md',
      )}>
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t('actions.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-4">{footer}</div> : null}
      </div>
    </div>
  );
}

export function TraceChatMissingDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('common');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
      <div className="w-full max-w-[337px] overflow-hidden rounded-[4px] border-t-[3px] border-[#F59A23] bg-white shadow-[0_16px_48px_rgba(15,23,42,0.18)] dark:bg-background">
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
            className="-mr-1 -mt-1 rounded-md p-1 text-[#4E5969] hover:bg-[#F2F3F5] hover:text-[#1D2129]"
            aria-label={t('actions.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex justify-end px-4 pb-4">
          <Button
            type="button"
            onClick={onClose}
            className="h-8 rounded-[10px] bg-[#1D2129] px-4 text-[13px] font-medium text-white shadow-none hover:bg-[#343A45]"
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
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
      <div className="w-full max-w-[454px] overflow-hidden rounded-[6px] border border-[#E5E6EB] bg-white shadow-2xl dark:border-border dark:bg-background">
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
              maxLength={FOLDER_NAME_MAX_LENGTH}
              onChange={(event) => setValue(event.target.value)}
              placeholder={label}
              className="h-[68px] w-full resize-none rounded-[6px] border border-[#C9CDD4] bg-white px-2 py-2 pr-12 text-[14px] font-medium leading-5 text-[#1D2129] outline-none placeholder:text-[#C9CDD4] focus:border-[#A8B0BD] dark:border-border dark:bg-background dark:text-foreground"
              autoFocus
            />
            <span className="pointer-events-none absolute bottom-2 right-2 text-[12px] leading-4 text-[#C9CDD4]">
              {value.length}/{FOLDER_NAME_MAX_LENGTH}
            </span>
          </div>
        </div>

        <div className="flex h-[64px] items-center justify-end gap-2 border-t border-[#E5E6EB] px-[18px] dark:border-border">
          <Button type="button" variant="outline" className="h-9 rounded-[14px] px-5 text-[14px] font-normal" onClick={onCancel}>
            {t('actions.cancel')}
          </Button>
          <Button type="button" className="h-9 rounded-[14px] bg-[#1D2129] px-5 text-[14px] font-normal text-white hover:bg-[#4E5969]" onClick={submit} disabled={saving}>
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
  onDownload,
}: {
  entry: DataCenterUiEntry;
  tempUrl: DataCenterTempUrl;
  onClose: () => void;
  onDownload: () => void;
}) {
  const { t } = useTranslation('common');
  return (
    <DataCenterModal
      title={entry.name}
      onClose={onClose}
      wide
      footer={(
        <>
          {!entry.localAuthorized ? (
            <Button type="button" variant="outline" onClick={onDownload}>
              <Download className="mr-2 h-4 w-4" />
              {t('dataCenterPage.menu.download')}
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={onClose}>{t('actions.close')}</Button>
        </>
      )}
    >
      <div className="h-[68vh] overflow-hidden rounded-lg border border-border bg-card">
        <FilePreviewViewer
          filePath={tempUrl.tempUrl}
          fileName={tempUrl.fileName || entry.name}
          mimeType={tempUrl.mimeType || entry.mimeType || 'application/octet-stream'}
          className="h-full w-full"
        />
      </div>
    </DataCenterModal>
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
  const [selectedEntryId, setSelectedEntryId] = useState(ROOT_ENTRY_ID);
  const [folderMap, setFolderMap] = useState<SharedFolderMap>({});
  const [loadingMap, setLoadingMap] = useState<SharedFolderLoadingMap>({});
  const [openMap, setOpenMap] = useState<SharedFolderOpenMap>({ [ROOT_ENTRY_ID]: true });
  const [saving, setSaving] = useState(false);

  const loadFolders = async (parentEntryId: string) => {
    setLoadingMap((prev) => ({ ...prev, [parentEntryId]: true }));
    try {
      const result = await listDataCenterEntries({
        spaceType: 'site_shared_artifact',
        spaceId: targetSpaceId,
        parentEntryId,
        entryType: 'folder',
        pageSize: 200,
        sortField: 'name',
        sortOrder: 'asc',
      });
      setFolderMap((prev) => ({
        ...prev,
        [parentEntryId]: result.items.filter((item) => item.entryType === 'folder'),
      }));
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
    if (nextOpen && folderMap[folderId] === undefined) {
      await loadFolders(folderId);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadFolders(ROOT_ENTRY_ID);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetSpaceId]);

  const submit = async () => {
    setSaving(true);
    try {
      await onConfirm(selectedEntryId);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DataCenterModal
      title={t('dataCenterPage.dialogs.uploadToSharedTitle')}
      onClose={onClose}
      footer={(
        <>
          <Button type="button" variant="outline" onClick={onClose}>{t('actions.cancel')}</Button>
          <Button type="button" onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t('actions.confirm')}
          </Button>
        </>
      )}
    >
      <div className="space-y-3">
        <p className="text-[13px] leading-5 text-[#4E5969] dark:text-muted-foreground">
          {t('dataCenterPage.dialogs.uploadToSharedMessage', { name: entry.name })}
        </p>
        <div className="rounded-[14px] bg-[#F7F8FA] p-2 dark:bg-muted/40">
          <div className="rounded-[10px] bg-white p-2.5 dark:bg-card">
            <SharedFolderPickerRow
              folderId={ROOT_ENTRY_ID}
              label={t('dataCenterPage.saveArtifact.sharedArtifacts')}
              selectedEntryId={selectedEntryId}
              open={openMap[ROOT_ENTRY_ID] ?? true}
              loading={loadingMap[ROOT_ENTRY_ID] ?? false}
              childrenFolders={folderMap[ROOT_ENTRY_ID] ?? []}
              folderMap={folderMap}
              loadingMap={loadingMap}
              openMap={openMap}
              onSelect={setSelectedEntryId}
              onToggle={toggleFolder}
            />
          </div>
        </div>
      </div>
    </DataCenterModal>
  );
}

function SharedFolderPickerRow({
  folderId,
  label,
  selectedEntryId,
  open,
  loading,
  childrenFolders,
  folderMap,
  loadingMap,
  openMap,
  onSelect,
  onToggle,
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
  onSelect: (entryId: string) => void;
  onToggle: (entryId: string) => void;
}) {
  const { t } = useTranslation('common');
  const selected = selectedEntryId === folderId;
  return (
    <div>
      <div className={cn('flex h-8 items-center gap-2 rounded-[8px] px-1.5', selected && 'bg-[#F2F3F5] dark:bg-muted')}>
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-[#C9CDD4]"
          checked={selected}
          onChange={() => onSelect(folderId)}
          aria-label={label}
        />
        <button
          type="button"
          className="flex h-5 w-5 items-center justify-center rounded hover:bg-[#F2F3F5] dark:hover:bg-muted"
          onClick={() => onToggle(folderId)}
          aria-label={open ? t('actions.collapse') : t('actions.expand')}
        >
          <ChevronDown className={cn('h-3.5 w-3.5 text-[#4E5969] transition-transform', !open && '-rotate-90')} />
        </button>
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => onSelect(folderId)}>
          <img src={directoryIcon} alt="" aria-hidden="true" className="h-5 w-5 shrink-0" />
          <span className="truncate text-[13px] font-semibold text-[#1D2129] dark:text-foreground">{label}</span>
        </button>
      </div>
      {open ? (
        <div className="mt-1 space-y-1 pl-8">
          {loading ? (
            <div className="flex h-8 items-center gap-2 text-[12px] text-[#86909C]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('dataCenterPage.saveArtifact.loading')}
            </div>
          ) : childrenFolders.length === 0 ? (
            <div className="flex h-8 items-center text-[12px] text-[#86909C]">{t('dataCenterPage.saveArtifact.emptyFolders')}</div>
          ) : (
            childrenFolders.map((folder) => (
              <SharedFolderPickerRow
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
                onSelect={onSelect}
                onToggle={onToggle}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
