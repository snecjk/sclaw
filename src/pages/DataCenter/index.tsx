import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  ChevronDown,
  Database,
  Folder,
  FolderPlus,
  Grid2X2,
  List,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { ArtifactShareDialog } from '@/components/file-preview/ArtifactShareDialog';
import { Button } from '@/components/ui/button';
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
import { useDataCenterStore } from '@/stores/data-center';
import { useLocalAuthorizedFilesStore } from '@/stores/local-authorized-files';
import { useAuthStore, isSiteUser } from '@/stores/auth';
import { useChatStore } from '@/stores/chat';
import type { DataCenterTempUrl } from '@/types/data-center';
import { EntryGrid, EntryList, FeedbackState } from './components/entries';
import { DataCenterModal, PreviewModal, TextPromptModal, UploadToSharedFolderDialog } from './components/modals';
import { FolderBreadcrumbBar, IconToggle, TabButton } from './components/navigation';
import { ROOT_ENTRY_ID } from './constants';
import type { DataCenterUiEntry, DriveTab, UploadToSharedTarget } from './types';
import {
  buildRenamedEntryName,
  formatBytes,
  formatUsagePercent,
  formatUsageProgressWidth,
  getRenameInputValue,
  getParentBreadcrumbId,
  localEntryToUiEntry,
  normalizeSectionParam,
} from './utils';

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
  const [uploadToSharedTarget, setUploadToSharedTarget] = useState<UploadToSharedTarget | null>(null);
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
      setUploadToSharedTarget({ entry, targetSpaceId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('dataCenterPage.toasts.sharedSpaceLoadFailed'));
    }
  };

  const handleConfirmUploadToShared = async (target: UploadToSharedTarget, targetParentEntryId: string) => {
    try {
      await shareDataCenterEntries({
        sourceEntryIds: [target.entry.entryId],
        targetSpaceId: target.targetSpaceId,
        targetParentEntryId,
        idempotencyKey: createDataCenterIdempotencyKey('share', `${target.entry.entryId}-${target.targetSpaceId}-${targetParentEntryId}`),
      });
      toast.success(t('dataCenterPage.toasts.sharedToSite'));
      setUploadToSharedTarget(null);
      if (isSharedArtifactSpace && store.spaceId === target.targetSpaceId) {
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
                          style={{ width: formatUsageProgressWidth(quotaUsedPercent) }}
                        />
                      </div>
                      <p className="mt-2 text-[13px] font-semibold leading-5 text-[#1D2129] dark:text-foreground">
                        {t('dataCenterPage.drive.usedPercent', { percent: formatUsagePercent(quotaUsedPercent) })}
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

      {uploadToSharedTarget ? (
        <UploadToSharedFolderDialog
          entry={uploadToSharedTarget.entry}
          targetSpaceId={uploadToSharedTarget.targetSpaceId}
          onClose={() => setUploadToSharedTarget(null)}
          onConfirm={(targetParentEntryId) => handleConfirmUploadToShared(uploadToSharedTarget, targetParentEntryId)}
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
