import { useEffect, useState, type ReactNode } from 'react';
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
  Search,
  Share2,
  Upload,
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
import { invokeIpc } from '@/lib/api-client';
import {
  DATA_CENTER_API_NOT_FOUND,
  createDataCenterIdempotencyKey,
  getDataCenterDownloadUrl,
  getDataCenterPreviewUrl,
  getDataCenterTrace,
  uploadDriveFileFromPath,
} from '@/lib/data-center-api';
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
import { useAuthStore, isSiteUser } from '@/stores/auth';
import { useChatStore } from '@/stores/chat';
import type { DataCenterEntry, DataCenterTempUrl } from '@/types/data-center';

const ROOT_ENTRY_ID = 'root';
const FOLDER_NAME_MAX_LENGTH = 15;
const SECTION_PARAM_VALUES: DataCenterSection[] = ['qa_artifact', 'drive'];
const actionTooltipClass = 'border-none bg-[#1D2129] px-2.5 py-1.5 text-[12px] font-medium leading-4 text-white shadow-none';

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
  entry: DataCenterEntry;
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
          <Button type="button" variant="outline" onClick={onDownload}>
            <Download className="mr-2 h-4 w-4" />
            {t('dataCenterPage.menu.download')}
          </Button>
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
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [renameEntry, setRenameEntry] = useState<DataCenterEntry | null>(null);
  const [deleteEntry, setDeleteEntry] = useState<DataCenterEntry | null>(null);
  const [previewState, setPreviewState] = useState<{ entry: DataCenterEntry; tempUrl: DataCenterTempUrl } | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareDraft, setShareDraft] = useState<DingTalkShareDialogDraft | null>(null);
  const [uploading, setUploading] = useState(false);
  const errorDescription = store.error === DATA_CENTER_API_NOT_FOUND
    ? t('dataCenterPage.feedback.apiNotFound')
    : store.error;

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
    void store.load({ resetPage: true });
    void store.refreshQuota();
    // Zustand action refs are stable enough here; listing the whole store object
    // would reload after every state update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.section, store.spaceType, store.parentEntryId, store.keyword, store.sortField, store.sortOrder]);

  const handleUpload = async () => {
    if (store.section !== 'drive') {
      toast.info(t('dataCenterPage.toasts.artifactSaveFromPreview'));
      return;
    }
    const result = await invokeIpc<{ canceled: boolean; filePaths?: string[] }>('dialog:open', {
      properties: ['openFile', 'multiSelections'],
    });
    const filePaths = result.filePaths ?? [];
    if (result.canceled || filePaths.length === 0) return;

    setUploading(true);
    try {
      for (const filePath of filePaths) {
        await uploadDriveFileFromPath({
          filePath,
          parentEntryId: store.parentEntryId,
          idempotencyKey: createDataCenterIdempotencyKey('drive', filePath.split(/[\\/]/).pop()),
        });
      }
      toast.success(filePaths.length > 1
        ? t('dataCenterPage.toasts.uploadedMany', { count: filePaths.length })
        : t('dataCenterPage.toasts.uploadedOne'));
      await store.load();
      await store.refreshQuota();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('dataCenterPage.toasts.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const handlePreview = async (entry: DataCenterEntry) => {
    if (entry.entryType !== 'file') return;
    try {
      const tempUrl = await getDataCenterPreviewUrl(entry.entryId);
      setPreviewState({ entry, tempUrl });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('dataCenterPage.preview.unsupported'));
    }
  };

  const handleDownload = async (entry: DataCenterEntry) => {
    if (entry.entryType !== 'file') return;
    try {
      const tempUrl = await getDataCenterDownloadUrl(entry.entryId);
      window.electron.openExternal(tempUrl.tempUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('dataCenterPage.toasts.downloadFailed'));
    }
  };

  const handleShare = async (entry: DataCenterEntry) => {
    if (entry.entryType !== 'file') {
      toast.info(t('dataCenterPage.toasts.folderShareUnsupported'));
      return;
    }
    try {
      const tempUrl = await getDataCenterDownloadUrl(entry.entryId);
      setShareDraft(buildArtifactShareDialogDraft({
        fileName: entry.name,
        filePath: tempUrl.tempUrl,
        mimeType: tempUrl.mimeType || entry.mimeType || 'application/octet-stream',
        fileSize: entry.fileSize,
      }, (key) => t(`chat:${key}`)));
      setShareDialogOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('chat:preview.shareDialog.failed'));
    }
  };

  const handleTrace = async (entry: DataCenterEntry) => {
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

          <div className={cn(workflowListToolbarClass, 'mb-[26px] shrink-0')}>
            <div className="flex h-9 items-center gap-6">
              {store.section === 'qa_artifact' ? (
                <>
                  <TabButton active>{t('dataCenterPage.tabs.myArtifacts')}</TabButton>
                  {isSite ? <TabButton disabled>{t('dataCenterPage.tabs.sharedArtifacts')}</TabButton> : null}
                </>
              ) : store.section === 'drive' ? (
                <>
                  <TabButton active>{t('dataCenterPage.tabs.onlineFiles')}</TabButton>
                  <TabButton disabled>{t('dataCenterPage.tabs.localFiles')}</TabButton>
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
                <Button type="button" variant="outline" className="h-[34px] rounded-[10px] border-0 bg-[#F2F3F5] px-3 text-[13px] font-medium text-[#1D2129] shadow-none hover:bg-[#E5E6EB] dark:bg-muted dark:text-foreground" onClick={() => setCreateFolderOpen(true)}>
                  <FolderPlus className="mr-2 h-4 w-4" />
                  {t('dataCenterPage.toolbar.createFolder')}
                </Button>
                {store.section === 'drive' ? (
                  <Button type="button" className="h-[34px]" onClick={handleUpload} disabled={uploading}>
                    {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                    {t('dataCenterPage.toolbar.uploadFile')}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>

        {store.section !== 'data_source' ? (
          <>
            {store.parentEntryId !== ROOT_ENTRY_ID ? (
              <FolderBreadcrumbBar
                breadcrumbs={store.breadcrumbs}
                onBack={() => store.openBreadcrumb(getParentBreadcrumbId(store.breadcrumbs))}
                onOpen={store.openBreadcrumb}
              />
            ) : null}

            <section className="mt-4 min-h-0 flex-1 overflow-hidden">
              {store.error ? (
                <FeedbackState icon={<AlertCircle className="h-8 w-8" />} title={t('dataCenterPage.feedback.loadFailed')} description={errorDescription ?? ''} />
              ) : store.loading ? (
                <FeedbackState icon={<Loader2 className="h-8 w-8 animate-spin" />} title={t('dataCenterPage.feedback.loadingTitle')} description={t('dataCenterPage.feedback.loadingDescription')} />
              ) : store.items.length === 0 ? (
                <FeedbackState
                  icon={<Folder className="h-8 w-8" />}
                  title={store.keyword ? t('dataCenterPage.feedback.noMatch') : t('dataCenterPage.feedback.empty')}
                  description={store.section === 'qa_artifact' ? t('dataCenterPage.feedback.qaEmptyDescription') : t('dataCenterPage.feedback.driveEmptyDescription')}
                />
              ) : store.viewMode === 'grid' ? (
                <EntryGrid
                  items={store.items}
                  onOpenFolder={store.enterFolder}
                  onPreview={handlePreview}
                  onDownload={handleDownload}
                  onShare={handleShare}
                  onRename={setRenameEntry}
                  onDelete={setDeleteEntry}
                  onTrace={handleTrace}
                />
              ) : (
                <EntryList
                  items={store.items}
                  onOpenFolder={store.enterFolder}
                  onPreview={handlePreview}
                  onDownload={handleDownload}
                  onShare={handleShare}
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
            await store.renameEntry(renameEntry.entryId, buildRenamedEntryName(renameEntry, name));
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
                    await store.deleteEntry(deleteEntry.entryId);
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

function TabButton({ active = false, disabled = false, children }: { active?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
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
              <EntryName entry={entry} onOpenFolder={props.onOpenFolder} />
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

function EntryGrid(props: EntryRenderProps) {
  return (
    <div className="h-full overflow-auto">
      <div className="grid grid-cols-[repeat(auto-fill,72px)] justify-start gap-x-[16px] gap-y-[22px] py-1">
        {props.items.map((entry) => (
          <button
            key={entry.entryId}
            type="button"
            onClick={() => entry.entryType === 'folder' ? props.onOpenFolder(entry) : props.onPreview(entry)}
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
    </div>
  );
}

interface EntryRenderProps {
  items: DataCenterEntry[];
  onOpenFolder: (entry: DataCenterEntry) => void;
  onPreview: (entry: DataCenterEntry) => void;
  onDownload: (entry: DataCenterEntry) => void;
  onShare: (entry: DataCenterEntry) => void;
  onRename: (entry: DataCenterEntry) => void;
  onDelete: (entry: DataCenterEntry) => void;
  onTrace: (entry: DataCenterEntry) => void;
}

function EntryName({ entry, onOpenFolder }: { entry: DataCenterEntry; onOpenFolder: (entry: DataCenterEntry) => void }) {
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
  return <div className="flex min-w-0 items-center gap-3">{content}</div>;
}

function EntryActions({
  entry,
  onDownload,
  onShare,
  onDelete,
  onTrace,
  uploadToSharedLabel,
}: EntryRenderProps & { entry: DataCenterEntry; uploadToSharedLabel?: string }) {
  const { t } = useTranslation('common');
  return (
    <div className="flex w-[128px] shrink-0 items-center justify-end gap-1 text-[#6B778C]">
      <ActionTooltip label={uploadToSharedLabel ?? ''}>
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-[#F2F3F5] hover:text-[#1D2129]"
          aria-label={uploadToSharedLabel}
        >
          <CloudUpload className="h-4 w-4" />
        </button>
      </ActionTooltip>
      {entry.entryType === 'file' ? (
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
          {entry.entryType === 'file' && entry.traceAvailable ? (
            <DropdownMenuItem onSelect={() => onTrace(entry)} className="text-[13px]">
              {t('dataCenterPage.menu.traceChat')}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => onDelete(entry)} className="text-[13px]">
            {t('dataCenterPage.menu.delete')}
          </DropdownMenuItem>
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
