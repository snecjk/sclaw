import { useEffect, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  CloudUpload,
  Database,
  Download,
  Folder,
  FolderPlus,
  Grid2X2,
  List,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  Share2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import directoryIcon from '@/assets/icons/directory.svg';
import docIcon from '@/assets/icons/doc-icon.png';
import excelIcon from '@/assets/icons/excel-icon.svg';
import htmlIcon from '@/assets/icons/html-icon.svg';
import imgIcon from '@/assets/icons/img-icon.svg';
import mdIcon from '@/assets/icons/md-icon.svg';
import pptIcon from '@/assets/icons/ppt-icon.svg';
import { ArtifactShareDialog } from '@/components/file-preview/ArtifactShareDialog';
import { FilePreviewViewer } from '@/components/file-preview/FilePreviewViewer';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DATA_CENTER_API_NOT_FOUND,
  createDataCenterIdempotencyKey,
  deleteDataCenterSharedEntry,
  getDataCenterDownloadUrl,
  getDataCenterPreviewUrl,
  getDataCenterTrace,
  shareDataCenterEntries,
  uploadDriveFileFromPath,
} from '@/lib/data-center-api';
import { invokeIpc } from '@/lib/api-client';
import {
  buildArtifactShareDialogDraft,
  type DingTalkShareDialogDraft,
} from '@/lib/dingtalk-share';
import {
  stoMainInnerShell,
  stoPageTitleClass,
  workflowListToolbarClass,
} from '@/lib/surfaces';
import { cn } from '@/lib/utils';
import { useDataCenterStore, type DataCenterSection } from '@/stores/data-center';
import { useLocalAuthorizedFilesStore } from '@/stores/local-authorized-files';
import { useAuthStore, isSiteUser } from '@/stores/auth';
import { useChatStore } from '@/stores/chat';
import type { DataCenterEntry, DataCenterTempUrl } from '@/types/data-center';
import type { LocalAuthorizedFileEntry } from '@/types/local-authorized-file';

const ROOT_ENTRY_ID = 'root';
const FOLDER_NAME_MAX_LENGTH = 15;
const SECTION_PARAM_VALUES: DataCenterSection[] = ['qa_artifact', 'drive'];
const actionTooltipClass = 'border-none bg-[#1D2129] px-2.5 py-1.5 text-[12px] font-medium leading-4 text-white shadow-none';

type DataCenterUiEntry = DataCenterEntry & {
  localAuthorized?: boolean;
  localPath?: string;
  missing?: boolean;
};
type DriveTab = 'local' | 'upload';

function normalizeSectionParam(value: string | null): DataCenterSection {
  return SECTION_PARAM_VALUES.includes(value as DataCenterSection)
    ? value as DataCenterSection
    : 'qa_artifact';
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

function formatDate(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year} / ${month} / ${day} ${hour}:${minute}`;
}

function getEntryIconSrc(entry: DataCenterEntry): string {
  if (entry.entryType === 'folder') return directoryIcon;
  const ext = entry.fileExt?.toLowerCase() || entry.name.split('.').pop()?.toLowerCase() || '';
  if (['doc', 'docx', 'pdf', 'txt', 'rtf'].includes(ext)) return docIcon;
  if (['xls', 'xlsx', 'csv'].includes(ext)) return excelIcon;
  if (['html', 'htm'].includes(ext)) return htmlIcon;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return imgIcon;
  if (['md', 'markdown'].includes(ext)) return mdIcon;
  if (['ppt', 'pptx'].includes(ext)) return pptIcon;
  return docIcon;
}

function localEntryToUiEntry(entry: LocalAuthorizedFileEntry): DataCenterUiEntry {
  return {
    entryId: entry.entryId,
    spaceType: 'drive',
    entryType: entry.entryType,
    parentEntryId: entry.parentEntryId,
    name: entry.name,
    mimeType: entry.mimeType,
    fileExt: entry.fileExt,
    fileSize: entry.fileSize,
    sourceType: 'local_upload',
    traceStatus: 'none',
    traceAvailable: false,
    status: entry.missing ? 'missing' : 'active',
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    localAuthorized: true,
    localPath: entry.path,
    missing: entry.missing,
  };
}

function getEntryIcon(entry: DataCenterEntry, className = 'h-5 w-5'): ReactNode {
  return <img src={getEntryIconSrc(entry)} alt="" aria-hidden="true" className={cn('object-contain', className)} />;
}

function getRenameInputValue(entry: DataCenterEntry): string {
  if (entry.entryType !== 'file') return entry.name;
  const ext = entry.fileExt?.trim().replace(/^\./, '') || '';
  if (ext && entry.name.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) {
    return entry.name.slice(0, -(ext.length + 1));
  }
  const dotIndex = entry.name.lastIndexOf('.');
  return dotIndex > 0 ? entry.name.slice(0, dotIndex) : entry.name;
}

function buildRenamedEntryName(entry: DataCenterEntry, inputName: string): string {
  if (entry.entryType !== 'file') return inputName;
  const ext = entry.fileExt?.trim().replace(/^\./, '');
  if (!ext) return inputName;
  return `${inputName}.${ext}`;
}

function DataCenterModal({
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

function TextPromptModal({
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

function PreviewModal({
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

export function DataCenter() {
  const { t } = useTranslation(['common', 'chat']);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const authUser = useAuthStore((s) => s.user);
  const siteDepartmentTypes = useAuthStore((s) => s.siteDepartmentTypes);
  const isSite = siteDepartmentTypes !== null && isSiteUser(authUser?.categoryCode);
  const store = useDataCenterStore();
  const localStore = useLocalAuthorizedFilesStore();
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [renameEntry, setRenameEntry] = useState<DataCenterUiEntry | null>(null);
  const [deleteEntry, setDeleteEntry] = useState<DataCenterUiEntry | null>(null);
  const [previewState, setPreviewState] = useState<{ entry: DataCenterUiEntry; tempUrl: DataCenterTempUrl } | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareDraft, setShareDraft] = useState<DingTalkShareDialogDraft | null>(null);
  const [uploading, setUploading] = useState(false);
  const [driveTab, setDriveTab] = useState<DriveTab>('local');
  const isDriveSection = store.section === 'drive';
  const isLocalDriveTab = isDriveSection && driveTab === 'local';
  const isUploadDriveTab = isDriveSection && driveTab === 'upload';
  const isSharedArtifactSpace = store.section === 'qa_artifact' && store.spaceType === 'site_shared_artifact';
  const isMyArtifactSpace = store.section === 'qa_artifact' && store.spaceType === 'qa_artifact';
  const canCreateFolder = isUploadDriveTab || (!isDriveSection && (!isSharedArtifactSpace || Boolean(store.spaceId)));
  const visibleItems: DataCenterUiEntry[] = isLocalDriveTab
    ? localStore.items.map(localEntryToUiEntry)
    : store.items;
  const currentViewMode = isLocalDriveTab ? localStore.viewMode : store.viewMode;
  const currentKeyword = isLocalDriveTab ? localStore.keyword : store.keyword;
  const currentLoading = isLocalDriveTab ? localStore.loading : store.loading;
  const currentError = isLocalDriveTab ? localStore.error : store.error;
  const currentParentEntryId = isLocalDriveTab ? localStore.parentEntryId : store.parentEntryId;
  const currentBreadcrumbs = isLocalDriveTab ? localStore.breadcrumbs : store.breadcrumbs;
  const folderCount = isLocalDriveTab ? localStore.stats.folderCount : store.items.filter((item) => item.entryType === 'folder').length;
  const fileCount = isLocalDriveTab ? localStore.stats.uncategorizedFileCount : store.items.filter((item) => item.entryType === 'file').length;
  const authorizedCount = isLocalDriveTab ? localStore.stats.authorizedCount : store.total;
  const quotaUsedPercent = store.quota?.usagePercent ?? 0;
  const quotaUsedText = store.quota
    ? t('dataCenterPage.toolbar.usedQuota', {
      used: formatBytes(store.quota.usedBytes),
      quota: formatBytes(store.quota.quotaBytes),
    })
    : t('dataCenterPage.toolbar.usedQuota', { used: formatBytes(0), quota: '-' });
  const errorDescription = currentError === DATA_CENTER_API_NOT_FOUND
    ? t('dataCenterPage.feedback.apiNotFound')
    : currentError;

  useEffect(() => {
    const rawSection = searchParams.get('section');
    const section = normalizeSectionParam(rawSection);
    if (rawSection !== section) {
      setSearchParams({ section }, { replace: true });
      return;
    }
    if (store.section !== section) {
      store.setSection(section);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setSearchParams, store.section]);

  useEffect(() => {
    if (store.section === 'data_source') return;
    if (store.section === 'drive') {
      if (driveTab === 'local') {
        void localStore.load();
      } else {
        void store.load({ resetPage: true });
        void store.refreshQuota();
      }
      return;
    }
    if (store.section === 'qa_artifact' && store.spaceType === 'site_shared_artifact' && !store.spaceId) {
      void store.loadSharedSpaces()
        .then((spaces) => {
          const spaceId = spaces[0]?.spaceId;
          if (spaceId) {
            store.setQaArtifactSpace('site_shared_artifact', spaceId);
          }
        })
        .catch((error) => {
          toast.error(error instanceof Error ? error.message : t('dataCenterPage.toasts.sharedSpaceLoadFailed'));
        });
      return;
    }
    void store.load({ resetPage: true });
    void store.refreshQuota();
    // Zustand action refs are stable enough here; listing the whole store object
    // would reload after every state update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.section, store.spaceType, store.spaceId, store.parentEntryId, store.keyword, store.sortField, store.sortOrder, localStore.parentEntryId, localStore.keyword, driveTab]);

  useEffect(() => {
    if (!isSite || store.section !== 'qa_artifact') return;
    void store.loadSharedSpaces().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSite, store.section]);

  const handleAuthorizeLocal = async () => {
    setUploading(true);
    try {
      const authorized = await localStore.authorize();
      if (authorized) {
        toast.success(t('dataCenterPage.toasts.localAuthorized'));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('dataCenterPage.toasts.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const handleUploadFiles = async () => {
    if (!isUploadDriveTab) {
      toast.info(t('dataCenterPage.toasts.artifactSaveFromPreview'));
      return;
    }
    try {
      const result = await invokeIpc<{ canceled: boolean; filePaths?: string[] }>('dialog:open', {
        properties: ['openFile', 'multiSelections'],
      });
      if (result.canceled || !result.filePaths?.length) return;

      setUploading(true);
      let uploadedCount = 0;
      for (const filePath of result.filePaths) {
        const fileName = filePath.split(/[\\/]/).pop() || undefined;
        await uploadDriveFileFromPath({
          filePath,
          fileName,
          parentEntryId: store.parentEntryId,
          idempotencyKey: createDataCenterIdempotencyKey('drive', `${store.parentEntryId}-${fileName ?? filePath}`),
        });
        uploadedCount += 1;
      }
      toast.success(uploadedCount === 1
        ? t('dataCenterPage.toasts.uploadedOne')
        : t('dataCenterPage.toasts.uploadedMany', { count: uploadedCount }));
      await store.load({ resetPage: true });
      await store.refreshQuota();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('dataCenterPage.toasts.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const handlePreview = async (entry: DataCenterUiEntry) => {
    if (entry.entryType !== 'file') return;
    if (entry.localAuthorized) {
      if (!entry.localPath) return;
      setPreviewState({
        entry,
        tempUrl: {
          entryId: entry.entryId,
          fileName: entry.name,
          mimeType: entry.mimeType,
          tempUrl: entry.localPath,
          expiresAt: '',
        },
      });
      return;
    }
    try {
      const tempUrl = await getDataCenterPreviewUrl(entry.entryId);
      setPreviewState({ entry, tempUrl });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('dataCenterPage.preview.unsupported'));
    }
  };

  const handleDownload = async (entry: DataCenterUiEntry) => {
    if (entry.entryType !== 'file') return;
    if (entry.localAuthorized) return;
    try {
      const tempUrl = await getDataCenterDownloadUrl(entry.entryId);
      window.electron.openExternal(tempUrl.tempUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('dataCenterPage.toasts.downloadFailed'));
    }
  };

  const handleShare = async (entry: DataCenterUiEntry) => {
    if (entry.entryType !== 'file') {
      toast.info(t('dataCenterPage.toasts.folderShareUnsupported'));
      return;
    }
    try {
      const filePath = entry.localAuthorized && entry.localPath
        ? entry.localPath
        : (await getDataCenterDownloadUrl(entry.entryId)).tempUrl;
      setShareDraft(buildArtifactShareDialogDraft({
        fileName: entry.name,
        filePath,
        mimeType: entry.mimeType || 'application/octet-stream',
        fileSize: entry.fileSize,
      }, (key) => t(`chat:${key}`)));
      setShareDialogOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('chat:preview.shareDialog.failed'));
    }
  };

  const handleSwitchSharedArtifacts = async () => {
    if (!isSite) return;
    try {
      const spaces = store.sharedSpaces.length ? store.sharedSpaces : await store.loadSharedSpaces();
      const spaceId = spaces[0]?.spaceId;
      store.setQaArtifactSpace('site_shared_artifact', spaceId ?? null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('dataCenterPage.toasts.sharedSpaceLoadFailed'));
    }
  };

  const handleSwitchMyArtifacts = () => {
    store.setQaArtifactSpace('qa_artifact');
  };

  const handleUploadToShared = async (entry: DataCenterUiEntry) => {
    if (entry.entryType !== 'file' || entry.spaceType !== 'qa_artifact') return;
    try {
      const spaces = store.sharedSpaces.length ? store.sharedSpaces : await store.loadSharedSpaces();
      const targetSpaceId = spaces[0]?.spaceId;
      if (!targetSpaceId) {
        toast.info(t('dataCenterPage.toasts.sharedSpaceUnavailable'));
        return;
      }
      await shareDataCenterEntries({
        sourceEntryIds: [entry.entryId],
        targetSpaceId,
        targetParentEntryId: 'root',
        idempotencyKey: createDataCenterIdempotencyKey('share', entry.entryId),
      });
      toast.success(t('dataCenterPage.toasts.sharedToSite'));
      if (isSharedArtifactSpace && store.spaceId === targetSpaceId) {
        await store.load({ resetPage: true });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('dataCenterPage.toasts.shareToSiteFailed'));
    }
  };

  const handleTrace = async (entry: DataCenterUiEntry) => {
    if (entry.localAuthorized) {
      toast.info(t('dataCenterPage.toasts.traceUnavailable'));
      return;
    }
    try {
      const trace = await getDataCenterTrace(entry.entryId);
      if (!trace.traceAvailable || !trace.sessionId) {
        toast.info(t('dataCenterPage.toasts.traceUnavailable'));
        return;
      }
      useChatStore.getState().switchSession(trace.sessionId);
      navigate('/');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('dataCenterPage.toasts.traceFailed'));
    }
  };

  const handleRenameEntry = async (entryId: string, name: string) => {
    if (isLocalDriveTab) {
      await localStore.renameEntry(entryId, name);
      return;
    }
    await store.renameEntry(entryId, name);
  };

  const handleDeleteEntry = async (entryId: string) => {
    if (isLocalDriveTab) {
      await localStore.deleteEntry(entryId);
      return;
    }
    if (isSharedArtifactSpace && deleteEntry?.shared && deleteEntry.canManage) {
      await deleteDataCenterSharedEntry(entryId);
      await store.load();
      return;
    }
    await store.deleteEntry(entryId);
    await store.refreshQuota();
  };

  const handleOpenFolder = (entry: DataCenterUiEntry) => {
    if (isLocalDriveTab) {
      void localStore.enterFolder({
        entryId: entry.entryId,
        entryType: entry.entryType,
        parentEntryId: entry.parentEntryId,
        name: entry.name,
        path: entry.localPath ?? '',
        mimeType: entry.mimeType,
        fileExt: entry.fileExt,
        fileSize: entry.fileSize,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        authorizedAt: entry.createdAt ?? entry.updatedAt ?? new Date().toISOString(),
        missing: entry.missing,
      });
      return;
    }
    void store.enterFolder(entry);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--sto-main-bg)]">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-6 [scrollbar-gutter:stable]">
        <main className={cn(stoMainInnerShell, 'flex min-h-0 flex-1 flex-col')}>
          <header className="mb-6 shrink-0">
            <h1 className={stoPageTitleClass}>
              {store.section === 'qa_artifact' ? t('dataCenterPage.sections.qaArtifact') : store.section === 'drive' ? t('dataCenterPage.sections.drive') : t('dataCenterPage.sections.dataSource')}
            </h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-muted-foreground">
              {store.section === 'qa_artifact'
                ? t('dataCenterPage.sectionDescriptions.qaArtifact')
                : store.section === 'drive'
                  ? t('dataCenterPage.sectionDescriptions.drive')
                  : t('dataCenterPage.sectionDescriptions.dataSource')}
            </p>
          </header>

          {store.section === 'drive' ? (
            <div className="mb-[26px] shrink-0">
              <div className="flex min-w-0 items-center justify-between gap-4">
                <div className="flex h-9 items-center gap-8">
                  <TabButton active={driveTab === 'local'} onClick={() => setDriveTab('local')}>{t('dataCenterPage.tabs.localFiles')}</TabButton>
                  <TabButton active={driveTab === 'upload'} onClick={() => setDriveTab('upload')}>{t('dataCenterPage.tabs.uploadFiles')}</TabButton>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#A8B0BD]" />
                    <input
                      value={currentKeyword}
                      onChange={(event) => isLocalDriveTab ? localStore.setKeyword(event.target.value) : store.setKeyword(event.target.value)}
                      placeholder={t('dataCenterPage.toolbar.searchPlaceholder')}
                      className="h-[34px] w-[300px] rounded-[10px] border border-[#E5E6EB] bg-white pl-9 pr-3 text-[13px] text-[#1D2129] outline-none placeholder:text-[#A8B0BD] focus:border-[#C9CDD4] focus:ring-0 dark:border-border dark:bg-background dark:text-foreground"
                    />
                  </div>
                  <Button type="button" variant="outline" className="h-[34px] rounded-[10px] border-[#E5E6EB] bg-white px-3 text-[13px] font-normal text-[#4E5969] shadow-none dark:border-border dark:bg-background dark:text-muted-foreground" disabled>
                    {t('dataCenterPage.toolbar.workflowFilterAll')}
                    <ChevronDown className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <div className="mt-4 flex min-w-0 items-start justify-between gap-4">
                <div className="min-w-0">
                  {isUploadDriveTab ? (
                    <>
                      <div className="h-2 w-[86px] overflow-hidden rounded-full bg-[#D8DDE6] dark:bg-muted">
                        <div
                          className="h-full rounded-full bg-[#1D2129] dark:bg-foreground"
                          style={{ width: `${Math.min(100, Math.max(0, quotaUsedPercent))}%` }}
                        />
                      </div>
                      <p className="mt-2 text-[13px] font-semibold leading-5 text-[#1D2129] dark:text-foreground">
                        {t('dataCenterPage.drive.usedPercent', { percent: Math.round(quotaUsedPercent) })}
                      </p>
                      <p className="mt-1 text-[12px] leading-5 text-[#6B778C] dark:text-muted-foreground">{quotaUsedText}</p>
                    </>
                  ) : (
                    <>
                      <p className="text-[14px] font-semibold leading-5 text-[#1D2129] dark:text-foreground">
                        {t('dataCenterPage.drive.authorizedCount', { count: authorizedCount })}
                      </p>
                      <p className="mt-1 text-[12px] leading-5 text-[#6B778C] dark:text-muted-foreground">
                        {t('dataCenterPage.drive.localSummary', { folders: folderCount, files: fileCount })}
                      </p>
                    </>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="flex h-[34px] items-center rounded-[10px] bg-[#F2F3F5] p-1 dark:bg-muted">
                    <IconToggle active={currentViewMode === 'grid'} label={t('dataCenterPage.toolbar.gridView')} onClick={() => isLocalDriveTab ? localStore.setViewMode('grid') : store.setViewMode('grid')}>
                      <Grid2X2 className="h-4 w-4" />
                    </IconToggle>
                    <IconToggle active={currentViewMode === 'list'} label={t('dataCenterPage.toolbar.listView')} onClick={() => isLocalDriveTab ? localStore.setViewMode('list') : store.setViewMode('list')}>
                      <List className="h-4 w-4" />
                    </IconToggle>
                  </div>
                  {isUploadDriveTab ? (
                    <>
                      <Button type="button" variant="outline" className="h-[34px] rounded-[10px] border-0 bg-[#F2F3F5] px-3 text-[13px] font-medium text-[#1D2129] shadow-none hover:bg-[#E5E6EB] dark:bg-muted dark:text-foreground" onClick={() => setCreateFolderOpen(true)}>
                        <FolderPlus className="mr-2 h-4 w-4" />
                        {t('dataCenterPage.toolbar.createFolder')}
                      </Button>
                      <Button type="button" variant="outline" className="h-[34px] rounded-[10px] border-0 bg-[#F2F3F5] px-3 text-[13px] font-medium text-[#1D2129] shadow-none hover:bg-[#E5E6EB] dark:bg-muted dark:text-foreground" onClick={handleUploadFiles} disabled={uploading}>
                        {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                        {t('dataCenterPage.toolbar.uploadFile')}
                      </Button>
                    </>
                  ) : (
                    <Button type="button" variant="outline" className="h-[34px] rounded-[10px] border-0 bg-[#F2F3F5] px-3 text-[13px] font-medium text-[#1D2129] shadow-none hover:bg-[#E5E6EB] dark:bg-muted dark:text-foreground" onClick={handleAuthorizeLocal} disabled={uploading}>
                      {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                      {t('dataCenterPage.toolbar.authorizeLocalFile')}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className={cn(workflowListToolbarClass, 'mb-[26px] shrink-0')}>
              <div className="flex h-9 items-center gap-6">
                {store.section === 'qa_artifact' ? (
                  <>
                    <TabButton active={isMyArtifactSpace} onClick={handleSwitchMyArtifacts}>{t('dataCenterPage.tabs.myArtifacts')}</TabButton>
                    {isSite ? (
                      <TabButton active={isSharedArtifactSpace} onClick={handleSwitchSharedArtifacts}>
                        {t('dataCenterPage.tabs.sharedArtifacts')}
                      </TabButton>
                    ) : null}
                  </>
                ) : (
                  <TabButton disabled>{t('dataCenterPage.tabs.pendingAccess')}</TabButton>
                )}
              </div>

              {store.section !== 'data_source' ? (
                <div className="flex min-w-0 items-center gap-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#A8B0BD]" />
                    <input
                      value={store.keyword}
                      onChange={(event) => store.setKeyword(event.target.value)}
                      placeholder={t('dataCenterPage.toolbar.searchPlaceholder')}
                      className="h-[34px] w-[300px] rounded-[10px] border border-[#E5E6EB] bg-white pl-9 pr-3 text-[13px] text-[#1D2129] outline-none placeholder:text-[#A8B0BD] focus:border-[#C9CDD4] focus:ring-0 dark:border-border dark:bg-background dark:text-foreground"
                    />
                  </div>
                  <Button type="button" variant="outline" className="h-[34px] rounded-[10px] border-[#E5E6EB] bg-white px-3 text-[13px] font-normal text-[#4E5969] shadow-none dark:border-border dark:bg-background dark:text-muted-foreground" disabled>
                    {t('dataCenterPage.toolbar.workflowFilterAll')}
                    <ChevronDown className="ml-1 h-3.5 w-3.5" />
                  </Button>
                  <div className="flex h-[34px] items-center rounded-[10px] bg-[#F2F3F5] p-1 dark:bg-muted">
                    <IconToggle active={store.viewMode === 'grid'} label={t('dataCenterPage.toolbar.gridView')} onClick={() => store.setViewMode('grid')}>
                      <Grid2X2 className="h-4 w-4" />
                    </IconToggle>
                    <IconToggle active={store.viewMode === 'list'} label={t('dataCenterPage.toolbar.listView')} onClick={() => store.setViewMode('list')}>
                      <List className="h-4 w-4" />
                    </IconToggle>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-[34px] rounded-[10px] border-0 bg-[#F2F3F5] px-3 text-[13px] font-medium text-[#1D2129] shadow-none hover:bg-[#E5E6EB] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-muted dark:text-foreground"
                    onClick={() => setCreateFolderOpen(true)}
                    disabled={!canCreateFolder}
                  >
                    <FolderPlus className="mr-2 h-4 w-4" />
                    {t('dataCenterPage.toolbar.createFolder')}
                  </Button>
                </div>
              ) : null}
            </div>
          )}

        {store.section !== 'data_source' ? (
          <>
            {currentParentEntryId !== ROOT_ENTRY_ID ? (
              <FolderBreadcrumbBar
                breadcrumbs={currentBreadcrumbs}
                onBack={() => isDriveSection
                  ? isLocalDriveTab
                    ? localStore.openBreadcrumb(getParentBreadcrumbId(currentBreadcrumbs))
                    : store.openBreadcrumb(getParentBreadcrumbId(currentBreadcrumbs))
                  : store.openBreadcrumb(getParentBreadcrumbId(currentBreadcrumbs))}
                onOpen={(entryId) => isDriveSection
                  ? isLocalDriveTab
                    ? localStore.openBreadcrumb(entryId)
                    : store.openBreadcrumb(entryId)
                  : store.openBreadcrumb(entryId)}
              />
            ) : null}

            <section className="mt-4 min-h-0 flex-1 overflow-hidden">
              {currentError ? (
                <FeedbackState icon={<AlertCircle className="h-8 w-8" />} title={t('dataCenterPage.feedback.loadFailed')} description={errorDescription ?? ''} />
              ) : currentLoading ? (
                <FeedbackState icon={<Loader2 className="h-8 w-8 animate-spin" />} title={t('dataCenterPage.feedback.loadingTitle')} description={t('dataCenterPage.feedback.loadingDescription')} />
              ) : visibleItems.length === 0 ? (
                <FeedbackState
                  icon={<Folder className="h-8 w-8" />}
                  title={currentKeyword ? t('dataCenterPage.feedback.noMatch') : t('dataCenterPage.feedback.empty')}
                  description={isSharedArtifactSpace
                    ? t('dataCenterPage.feedback.sharedQaEmptyDescription')
                    : store.section === 'qa_artifact'
                      ? t('dataCenterPage.feedback.qaEmptyDescription')
                      : isUploadDriveTab
                        ? t('dataCenterPage.feedback.uploadDriveEmptyDescription')
                        : t('dataCenterPage.feedback.driveEmptyDescription')}
                />
              ) : currentViewMode === 'grid' ? (
                <EntryGrid
                  items={visibleItems}
                  onOpenFolder={handleOpenFolder}
                  onPreview={handlePreview}
                  onDownload={handleDownload}
                  onShare={handleShare}
                  onUploadToShared={handleUploadToShared}
                  onRename={setRenameEntry}
                  onDelete={setDeleteEntry}
                  onTrace={handleTrace}
                />
              ) : (
                <EntryList
                  items={visibleItems}
                  onOpenFolder={handleOpenFolder}
                  onPreview={handlePreview}
                  onDownload={handleDownload}
                  onShare={handleShare}
                  onUploadToShared={handleUploadToShared}
                  onRename={setRenameEntry}
                  onDelete={setDeleteEntry}
                  onTrace={handleTrace}
                />
              )}
            </section>
          </>
        ) : (
          <div className="mt-10">
            <FeedbackState icon={<Database className="h-8 w-8" />} title={t('dataCenterPage.feedback.dataSourceTitle')} description={t('dataCenterPage.feedback.dataSourceDescription')} />
          </div>
        )}
        </main>
      </div>

      {createFolderOpen ? (
        <TextPromptModal
          title={t('dataCenterPage.dialogs.createFolderTitle')}
          label={t('dataCenterPage.dialogs.folderName')}
          onCancel={() => setCreateFolderOpen(false)}
          onConfirm={async (name) => {
            if (!canCreateFolder) {
              setCreateFolderOpen(false);
              return;
            }
            await store.createFolder(name);
            setCreateFolderOpen(false);
            toast.success(t('dataCenterPage.toasts.folderCreated'));
          }}
        />
      ) : null}

      {renameEntry ? (
        <TextPromptModal
          title={t('dataCenterPage.dialogs.renameTitle')}
          label={t('dataCenterPage.dialogs.newName')}
          initialValue={getRenameInputValue(renameEntry)}
          onCancel={() => setRenameEntry(null)}
          onConfirm={async (name) => {
            await handleRenameEntry(renameEntry.entryId, buildRenamedEntryName(renameEntry, name));
            setRenameEntry(null);
            toast.success(t('dataCenterPage.toasts.renamed'));
          }}
        />
      ) : null}

      {deleteEntry ? (
        <DataCenterModal
          title={t('dataCenterPage.dialogs.deleteTitle')}
          onClose={() => setDeleteEntry(null)}
          footer={(
            <>
              <Button type="button" variant="outline" onClick={() => setDeleteEntry(null)}>{t('actions.cancel')}</Button>
              <Button
                type="button"
                variant="destructive"
                onClick={async () => {
                  try {
                    await handleDeleteEntry(deleteEntry.entryId);
                    setDeleteEntry(null);
                    toast.success(t('dataCenterPage.toasts.deleted'));
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : t('dataCenterPage.toasts.deleteFailed'));
                  }
                }}
              >
                {t('actions.delete')}
              </Button>
            </>
          )}
        >
          <p className="text-sm text-muted-foreground">
            {t('dataCenterPage.dialogs.deleteMessage', { name: deleteEntry.name })}
          </p>
        </DataCenterModal>
      ) : null}

      {previewState ? (
        <PreviewModal
          entry={previewState.entry}
          tempUrl={previewState.tempUrl}
          onClose={() => setPreviewState(null)}
          onDownload={() => handleDownload(previewState.entry)}
        />
      ) : null}

      <ArtifactShareDialog
        open={shareDialogOpen}
        draft={shareDraft}
        onShared={() => {
          toast.success(t('chat:preview.shareDialog.success'));
          setShareDialogOpen(false);
          setShareDraft(null);
        }}
        onCancel={() => {
          setShareDialogOpen(false);
          setShareDraft(null);
        }}
        onError={(error) => {
          toast.error(error instanceof Error ? error.message : t('chat:preview.shareDialog.failed'));
        }}
      />
    </div>
  );
}

function TabButton({
  active = false,
  disabled = false,
  children,
  onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'relative h-9 px-0 text-[16px] font-semibold transition-colors',
        active ? 'text-[#1D2129] dark:text-foreground' : 'text-[#86909C] dark:text-muted-foreground',
        disabled && 'cursor-not-allowed opacity-70',
      )}
    >
      {children}
    </button>
  );
}

function IconToggle({ active, label, children, onClick }: { active: boolean; label: string; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-[#6B778C] transition-colors',
        active && 'bg-white text-[#1D2129] shadow-sm dark:bg-background dark:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function getParentBreadcrumbId(breadcrumbs: Array<{ entryId: string; name: string }>): string {
  return breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2].entryId : ROOT_ENTRY_ID;
}

function FolderBreadcrumbBar({
  breadcrumbs,
  onBack,
  onOpen,
}: {
  breadcrumbs: Array<{ entryId: string; name: string }>;
  onBack: () => void;
  onOpen: (entryId: string) => void;
}) {
  const { t } = useTranslation('common');
  const items = breadcrumbs.length ? breadcrumbs : [{ entryId: ROOT_ENTRY_ID, name: t('dataCenterPage.entry.root') }];
  return (
    <div className="mt-4 flex shrink-0 items-center overflow-hidden">
      <button
        type="button"
        onClick={onBack}
        className="mr-3 inline-flex shrink-0 items-center gap-1 text-[16px] font-semibold leading-6 text-[#FF6A00] hover:text-[#E95F00]"
      >
        <ArrowLeft className="h-5 w-5" />
        {t('actions.back')}
      </button>
      <div className="flex min-w-0 items-center gap-3 text-[16px] font-semibold leading-6">
        {items.map((item, index) => (
          <div key={`${item.entryId}-${index}`} className="flex min-w-0 items-center gap-3">
            {index > 0 ? <span className="shrink-0 text-[#E5E6EB]">/</span> : null}
            <button
              type="button"
              onClick={() => onOpen(item.entryId)}
              disabled={index === items.length - 1}
              className={cn(
                'truncate text-[#6B778C] transition-colors hover:text-[#1D2129] disabled:cursor-default disabled:hover:text-[#1D2129]',
                index === items.length - 1 && 'text-[#1D2129] dark:text-foreground',
              )}
            >
              {item.name}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function EntryList(props: EntryRenderProps) {
  const { t } = useTranslation('common');
  return (
    <div className="h-full overflow-auto pr-1">
      <div className="flex flex-col gap-2">
        {props.items.map((entry) => (
          <div
            key={entry.entryId}
            className="flex h-[56px] items-center rounded-[8px] bg-white px-3 shadow-[0_1px_2px_rgba(29,33,41,0.02)] transition-colors hover:bg-[#FAFBFC] dark:bg-card dark:hover:bg-muted/40"
          >
            <div className="min-w-0 flex-1">
              <EntryName entry={entry} onOpenFolder={props.onOpenFolder} onPreview={props.onPreview} />
            </div>
            <div className="w-[168px] shrink-0 text-[12px] leading-5 text-[#6B778C] dark:text-muted-foreground">
              {formatDate(entry.updatedAt)}
            </div>
            <div className="w-[74px] shrink-0 text-[12px] leading-5 text-[#6B778C] dark:text-muted-foreground">
              {entry.entryType === 'folder' ? '-' : formatBytes(entry.fileSize)}
            </div>
            <EntryActions entry={entry} {...props} uploadToSharedLabel={t('dataCenterPage.menu.uploadToShared')} />
          </div>
        ))}
      </div>
    </div>
  );
}

type GridContextMenuState = {
  entry: DataCenterUiEntry;
  x: number;
  y: number;
} | null;

function EntryGrid(props: EntryRenderProps) {
  const [contextMenu, setContextMenu] = useState<GridContextMenuState>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  const openContextMenu = (event: ReactMouseEvent, entry: DataCenterUiEntry) => {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 132;
    const menuHeight = entry.entryType === 'file' && entry.traceAvailable ? 180 : 140;
    setContextMenu({
      entry,
      x: Math.min(event.clientX, window.innerWidth - menuWidth - 8),
      y: Math.min(event.clientY, window.innerHeight - menuHeight - 8),
    });
  };

  const runContextAction = (action: (entry: DataCenterUiEntry) => void, entry: DataCenterUiEntry) => {
    setContextMenu(null);
    action(entry);
  };

  return (
    <div className="h-full overflow-auto">
      <div className="grid grid-cols-[repeat(auto-fill,72px)] justify-start gap-x-[16px] gap-y-[22px] py-1">
        {props.items.map((entry) => (
          <button
            key={entry.entryId}
            type="button"
            onClick={() => entry.entryType === 'folder' ? props.onOpenFolder(entry) : props.onPreview(entry)}
            onContextMenu={(event) => openContextMenu(event, entry)}
            className="flex w-[72px] flex-col items-center rounded-[8px] px-1 py-1 text-center transition-colors hover:bg-[#F2F3F5] dark:hover:bg-muted/40"
          >
            <span className="flex h-[46px] w-[46px] items-center justify-center">
              {getEntryIcon(entry, 'h-[42px] w-[42px]')}
            </span>
            <span className="mt-1 line-clamp-2 min-h-[34px] w-full break-all text-[13px] font-semibold leading-[17px] text-[#1D2129] dark:text-foreground">
              {entry.name}
            </span>
          </button>
        ))}
      </div>
      {contextMenu ? (
        <GridEntryContextMenu
          entry={contextMenu.entry}
          x={contextMenu.x}
          y={contextMenu.y}
          onDownload={(entry) => runContextAction(props.onDownload, entry)}
          onPreview={(entry) => runContextAction(props.onPreview, entry)}
          onShare={(entry) => runContextAction(props.onShare, entry)}
          onRename={(entry) => runContextAction(props.onRename, entry)}
          onDelete={(entry) => runContextAction(props.onDelete, entry)}
          onTrace={(entry) => runContextAction(props.onTrace, entry)}
        />
      ) : null}
    </div>
  );
}

function GridEntryContextMenu({
  entry,
  x,
  y,
  onDownload,
  onPreview,
  onShare,
  onRename,
  onDelete,
  onTrace,
}: {
  entry: DataCenterUiEntry;
  x: number;
  y: number;
  onDownload: (entry: DataCenterUiEntry) => void;
  onPreview: (entry: DataCenterUiEntry) => void;
  onShare: (entry: DataCenterUiEntry) => void;
  onRename: (entry: DataCenterUiEntry) => void;
  onDelete: (entry: DataCenterUiEntry) => void;
  onTrace: (entry: DataCenterUiEntry) => void;
}) {
  const { t } = useTranslation('common');
  const canRenameEntry = !entry.localAuthorized && (entry.spaceType !== 'site_shared_artifact' || entry.canManage === true);
  const canDeleteEntry = entry.localAuthorized
    ? entry.parentEntryId === ROOT_ENTRY_ID
    : entry.spaceType !== 'site_shared_artifact' || entry.canManage === true;
  const canDownloadEntry = entry.entryType === 'file' && !entry.localAuthorized;
  return (
    <div
      className="fixed z-[70] min-w-[128px] rounded-[10px] border border-[#E5E6EB] bg-white p-2 text-[#1D2129] shadow-[0_8px_24px_rgba(15,23,42,0.14)] dark:border-border dark:bg-popover dark:text-foreground"
      style={{ left: x, top: y }}
      role="menu"
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {entry.entryType === 'file' ? (
        <ContextMenuButton onClick={() => onPreview(entry)}>
          {t('dataCenterPage.menu.preview')}
        </ContextMenuButton>
      ) : null}
      {canDownloadEntry ? (
        <ContextMenuButton onClick={() => onDownload(entry)}>
          {t('dataCenterPage.menu.download')}
        </ContextMenuButton>
      ) : null}
      {entry.entryType === 'file' ? (
        <ContextMenuButton onClick={() => onShare(entry)}>
          {t('dataCenterPage.menu.share')}
        </ContextMenuButton>
      ) : null}
      {entry.entryType === 'file' && entry.traceAvailable ? (
        <ContextMenuButton onClick={() => onTrace(entry)}>
          {t('dataCenterPage.menu.traceChat')}
        </ContextMenuButton>
      ) : null}
      {canRenameEntry ? (
        <ContextMenuButton onClick={() => onRename(entry)}>
          {t('dataCenterPage.menu.rename')}
        </ContextMenuButton>
      ) : null}
      {canDeleteEntry ? (
        <ContextMenuButton onClick={() => onDelete(entry)}>
          {entry.localAuthorized ? t('dataCenterPage.menu.removeAuthorization') : t('dataCenterPage.menu.delete')}
        </ContextMenuButton>
      ) : null}
    </div>
  );
}

function ContextMenuButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="block h-9 w-full rounded-[6px] px-3 text-left text-[13px] leading-9 hover:bg-[#F2F3F5] dark:hover:bg-muted"
    >
      {children}
    </button>
  );
}

interface EntryRenderProps {
  items: DataCenterUiEntry[];
  onOpenFolder: (entry: DataCenterUiEntry) => void;
  onPreview: (entry: DataCenterUiEntry) => void;
  onDownload: (entry: DataCenterUiEntry) => void;
  onShare: (entry: DataCenterUiEntry) => void;
  onUploadToShared: (entry: DataCenterUiEntry) => void;
  onRename: (entry: DataCenterUiEntry) => void;
  onDelete: (entry: DataCenterUiEntry) => void;
  onTrace: (entry: DataCenterUiEntry) => void;
}

function EntryName({
  entry,
  onOpenFolder,
  onPreview,
}: {
  entry: DataCenterUiEntry;
  onOpenFolder: (entry: DataCenterUiEntry) => void;
  onPreview: (entry: DataCenterUiEntry) => void;
}) {
  const { t } = useTranslation('common');
  const content = (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center">{getEntryIcon(entry, entry.entryType === 'folder' ? 'h-8 w-8' : 'h-7 w-7')}</span>
      <span className="min-w-0 py-1">
        <span className="block truncate text-[13px] font-semibold leading-5 text-[#1D2129] dark:text-foreground">{entry.name}</span>
        {entry.traceStatus === 'pending' ? (
          <span className="inline-flex h-4 items-center rounded bg-[#EEF3FF] px-1.5 text-[11px] leading-4 text-[#4E7FFF]">
            {t('dataCenterPage.entry.tracePending')}
          </span>
        ) : entry.traceAvailable ? (
          <span className="inline-flex h-4 items-center rounded bg-[#F2F3F5] px-1.5 text-[11px] leading-4 text-[#6B778C]">
            {t('dataCenterPage.entry.traceAvailable')}
          </span>
        ) : null}
      </span>
    </>
  );
  if (entry.entryType === 'folder') {
    return (
      <button type="button" onClick={() => onOpenFolder(entry)} className="flex min-w-0 items-center gap-3 text-left">
        {content}
      </button>
    );
  }
  return (
    <button type="button" onClick={() => onPreview(entry)} className="flex min-w-0 items-center gap-3 text-left">
      {content}
    </button>
  );
}

function EntryActions({
  entry,
  onPreview,
  onDownload,
  onShare,
  onUploadToShared,
  onRename,
  onDelete,
  onTrace,
  uploadToSharedLabel,
}: EntryRenderProps & { entry: DataCenterUiEntry; uploadToSharedLabel?: string }) {
  const { t } = useTranslation('common');
  const canUploadToShared = entry.entryType === 'file' && entry.spaceType === 'qa_artifact' && !entry.localAuthorized;
  const canRenameEntry = !entry.localAuthorized && (entry.spaceType !== 'site_shared_artifact' || entry.canManage === true);
  const canDeleteEntry = entry.localAuthorized
    ? entry.parentEntryId === ROOT_ENTRY_ID
    : entry.spaceType !== 'site_shared_artifact' || entry.canManage === true;
  const canDownloadEntry = entry.entryType === 'file' && !entry.localAuthorized;
  return (
    <div className="flex w-[128px] shrink-0 items-center justify-end gap-1 text-[#6B778C]">
      {canUploadToShared ? (
        <ActionTooltip label={uploadToSharedLabel ?? ''}>
          <button
            type="button"
            onClick={() => onUploadToShared(entry)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-[#F2F3F5] hover:text-[#1D2129]"
            aria-label={uploadToSharedLabel}
          >
            <CloudUpload className="h-4 w-4" />
          </button>
        </ActionTooltip>
      ) : null}
      {canDownloadEntry ? (
        <ActionTooltip label={t('dataCenterPage.menu.download')}>
          <button
            type="button"
            onClick={() => onDownload(entry)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-[#F2F3F5] hover:text-[#1D2129]"
            aria-label={t('dataCenterPage.menu.download')}
          >
            <Download className="h-4 w-4" />
          </button>
        </ActionTooltip>
      ) : null}
      {entry.entryType === 'file' ? (
        <ActionTooltip label={t('dataCenterPage.menu.share')}>
          <button
            type="button"
            onClick={() => onShare(entry)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-[#F2F3F5] hover:text-[#1D2129]"
            aria-label={t('dataCenterPage.menu.share')}
          >
            <Share2 className="h-4 w-4" />
          </button>
        </ActionTooltip>
      ) : null}
      <DropdownMenu>
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-[#F2F3F5] hover:text-[#1D2129]" aria-label={t('dataCenterPage.menu.more')}>
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6} className={actionTooltipClass}>
            {t('dataCenterPage.menu.more')}
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="min-w-[128px] rounded-[10px] p-2">
          {entry.entryType === 'file' ? (
            <DropdownMenuItem onSelect={() => onPreview(entry)} className="text-[13px]">
              {t('dataCenterPage.menu.preview')}
            </DropdownMenuItem>
          ) : null}
          {entry.entryType === 'file' && entry.traceAvailable ? (
            <DropdownMenuItem onSelect={() => onTrace(entry)} className="text-[13px]">
              {t('dataCenterPage.menu.traceChat')}
            </DropdownMenuItem>
          ) : null}
          {canRenameEntry ? (
            <DropdownMenuItem onSelect={() => onRename(entry)} className="text-[13px]">
              {t('dataCenterPage.menu.rename')}
            </DropdownMenuItem>
          ) : null}
          {canDeleteEntry ? (
            <DropdownMenuItem onSelect={() => onDelete(entry)} className="text-[13px]">
              {entry.localAuthorized ? t('dataCenterPage.menu.removeAuthorization') : t('dataCenterPage.menu.delete')}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ActionTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className={actionTooltipClass}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function FeedbackState({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="flex h-full min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-background text-center">
      <div className="text-muted-foreground">{icon}</div>
      <h2 className="mt-4 text-base font-semibold text-foreground">{title}</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
