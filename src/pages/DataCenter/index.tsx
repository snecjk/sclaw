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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  DATA_CENTER_API_NOT_FOUND,
  createDataCenterIdempotencyKey,
  deleteDataCenterSharedEntry,
  getDataCenterDownloadUrl,
  getDataCenterPreviewUrl,
  moveDataCenterEntry,
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
import type { LocalAuthorizeSelectionType } from '@/types/local-authorized-file';
import { EntryGrid, EntryList, FeedbackState } from './components/entries';
import { DataCenterModal, MoveEntryDialog, PreviewModal, TextPromptModal, TraceChatMissingDialog, UploadToSharedFolderDialog } from './components/modals';
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

type AssociationFilter = 'all' | 'task';

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
  const [moveEntry, setMoveEntry] = useState<DataCenterUiEntry | null>(null);
  const [previewState, setPreviewState] = useState<{ entry: DataCenterUiEntry; tempUrl: DataCenterTempUrl } | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareDraft, setShareDraft] = useState<DingTalkShareDialogDraft | null>(null);
  const [uploadToSharedTarget, setUploadToSharedTarget] = useState<UploadToSharedTarget | null>(null);
  const [traceMissingOpen, setTraceMissingOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [driveTab, setDriveTab] = useState<DriveTab>('local');
  const [associationFilter, setAssociationFilter] = useState<AssociationFilter>('all');
  const isDriveSection = store.section === 'drive';
  const isLocalDriveTab = isDriveSection && driveTab === 'local';
  const isUploadDriveTab = isDriveSection && driveTab === 'upload';
  const isSharedArtifactSpace = store.section === 'qa_artifact' && store.spaceType === 'site_shared_artifact';
  const isMyArtifactSpace = store.section === 'qa_artifact' && store.spaceType === 'qa_artifact';
  const canCreateFolder = isUploadDriveTab || (!isDriveSection && (!isSharedArtifactSpace || Boolean(store.spaceId)));
  const baseVisibleItems: DataCenterUiEntry[] = isLocalDriveTab
    ? localStore.items.map(localEntryToUiEntry)
    : store.items;
  const visibleItems: DataCenterUiEntry[] = store.section === 'qa_artifact' && associationFilter === 'task'
    ? baseVisibleItems.filter((item) => item.sourceType === 'scheduled_task_artifact')
    : baseVisibleItems;
  const currentViewMode = isLocalDriveTab ? localStore.viewMode : store.viewMode;
  const currentKeyword = isLocalDriveTab ? localStore.keyword : store.keyword;
  const currentLoading = isLocalDriveTab ? localStore.loading : store.loading;
  const currentError = isLocalDriveTab ? localStore.error : store.error;
  const localPermissionDenied = isLocalDriveTab ? localStore.permissionDenied : null;
  const currentParentEntryId = isLocalDriveTab ? localStore.parentEntryId : store.parentEntryId;
  const currentBreadcrumbs = isLocalDriveTab ? localStore.breadcrumbs : store.breadcrumbs;
  const folderCount = isLocalDriveTab ? localStore.stats.folderCount : store.items.filter((item) => item.entryType === 'folder').length;
  const fileCount = isLocalDriveTab ? localStore.stats.uncategorizedFileCount : store.items.filter((item) => item.entryType === 'file').length;
  const authorizedCount = isLocalDriveTab ? localStore.stats.authorizedCount : store.total;
  const canLoadMore = !isLocalDriveTab && store.hasMore;
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
  const emptyFeedbackDescription = (() => {
    if (isLocalDriveTab && currentParentEntryId !== ROOT_ENTRY_ID) return '';
    if (isSharedArtifactSpace) return t('dataCenterPage.feedback.sharedQaEmptyDescription');
    if (store.section === 'qa_artifact') return t('dataCenterPage.feedback.qaEmptyDescription');
    if (isUploadDriveTab) return t('dataCenterPage.feedback.uploadDriveEmptyDescription');
    return t('dataCenterPage.feedback.driveEmptyDescription');
  })();

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

  const handleAuthorizeLocal = async (selectionType: LocalAuthorizeSelectionType) => {
    setUploading(true);
    try {
      const result = await localStore.authorize(selectionType);
      if (result.acceptedCount > 0) {
        toast.success(t('dataCenterPage.toasts.localAuthorized'));
      }
      if (result.skippedCount > 0) {
        toast.warning(t('dataCenterPage.toasts.localAuthorizationSkipped', { count: result.skippedCount }));
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

  const handleRefreshPreview = async (entry: DataCenterUiEntry) => {
    if (entry.entryType !== 'file' || entry.localAuthorized) return;
    try {
      const tempUrl = await getDataCenterPreviewUrl(entry.entryId);
      setPreviewState((current) => {
        if (!current || current.entry.entryId !== entry.entryId) return current;
        return { ...current, tempUrl };
      });
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
    if (!isSite) return;
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
    if (entry.localAuthorized || !entry.sessionId) {
      toast.info(t('dataCenterPage.toasts.traceUnavailable'));
      return;
    }
    let targetSession = useChatStore.getState().sessions.find((session) => session.key === entry.sessionId);
    if (!targetSession) {
      await useChatStore.getState().loadSessions();
      targetSession = useChatStore.getState().sessions.find((session) => session.key === entry.sessionId);
    }
    if (!targetSession) {
      setTraceMissingOpen(true);
      return;
    }
    useChatStore.getState().switchSession(entry.sessionId);
    navigate('/');
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
      await store.load({ resetPage: true });
      return;
    }
    await store.deleteEntry(entryId);
    await store.refreshQuota();
  };

  const handleMoveEntry = async (entry: DataCenterUiEntry, targetParentEntryId: string) => {
    if (entry.localAuthorized) return;
    await moveDataCenterEntry(entry.entryId, targetParentEntryId);
    await store.load({ resetPage: true });
    await store.refreshQuota();
  };

  const handleMoveToFolder = async (entry: DataCenterUiEntry, targetFolder: DataCenterUiEntry) => {
    try {
      await handleMoveEntry(entry, targetFolder.entryId);
      toast.success(t('dataCenterPage.toasts.moved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('dataCenterPage.toasts.moveFailed'));
    }
  };

  const handleOpenFolder = (entry: DataCenterUiEntry) => {
    if (entry.permissionDenied) {
      toast.error(t('dataCenterPage.toasts.localPermissionDenied', { name: entry.name }));
      return;
    }
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
        permissionDenied: entry.permissionDenied,
      });
      return;
    }
    void store.enterFolder(entry);
  };

  const handleLoadMore = async () => {
    try {
      await store.loadMore();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('dataCenterPage.feedback.loadFailed'));
    }
  };

  const deleteDialogTitle = deleteEntry?.localAuthorized
    ? t('dataCenterPage.dialogs.removeAuthorizationTitle')
    : t('dataCenterPage.dialogs.deleteTitle');
  const deleteDialogMessage = deleteEntry?.localAuthorized
    ? deleteEntry.parentEntryId === ROOT_ENTRY_ID
      ? t('dataCenterPage.dialogs.removeAuthorizationRootMessage', { name: deleteEntry.name })
      : t('dataCenterPage.dialogs.removeAuthorizationChildMessage', { name: deleteEntry.name })
    : t(
      deleteEntry?.entryType === 'file'
        ? 'dataCenterPage.dialogs.deleteFileMessage'
        : 'dataCenterPage.dialogs.deleteMessage',
      { name: deleteEntry?.name ?? '' },
    );
  const deleteConfirmLabel = deleteEntry?.localAuthorized
    ? t('dataCenterPage.menu.removeAuthorization')
    : t('actions.delete');
  const deleteSuccessMessage = deleteEntry?.localAuthorized
    ? t('dataCenterPage.toasts.authorizationRemoved')
    : t('dataCenterPage.toasts.deleted');

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--sto-main-bg)]">
      <div className="flex min-h-0 flex-1 flex-col overflow-x-auto overflow-y-auto px-6 py-6 [scrollbar-gutter:stable]">
        <main className={cn(stoMainInnerShell, 'flex min-h-0 min-w-[620px] flex-1 flex-col')}>
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
            <div className="mb-[18px] shrink-0">
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
                      className="h-[34px] w-[300px] rounded-[10px] border border-[#E5E6EB] bg-white pl-9 pr-3 text-[13px] text-[#1D2129] outline-none placeholder:text-[#A8B0BD] focus:border-[#C9CDD4] focus:ring-0 dark:border-border dark:bg-background dark:text-foreground dark:placeholder:text-muted-foreground"
                    />
                  </div>
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
                      <Button type="button" variant="outline" className="h-[34px] rounded-[10px] border-0 bg-[#F2F3F5] px-3 text-[13px] font-medium text-[#1D2129] shadow-none hover:bg-[#E5E6EB] dark:bg-muted dark:text-foreground dark:hover:bg-muted/70" onClick={() => setCreateFolderOpen(true)}>
                        <FolderPlus className="mr-2 h-4 w-4" />
                        {t('dataCenterPage.toolbar.createFolder')}
                      </Button>
                      <Button type="button" variant="outline" className="h-[34px] rounded-[10px] border-0 bg-[#F2F3F5] px-3 text-[13px] font-medium text-[#1D2129] shadow-none hover:bg-[#E5E6EB] dark:bg-muted dark:text-foreground dark:hover:bg-muted/70" onClick={handleUploadFiles} disabled={uploading}>
                        {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                        {t('dataCenterPage.toolbar.uploadFile')}
                      </Button>
                    </>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="outline" className="h-[34px] rounded-[10px] border-0 bg-[#F2F3F5] px-3 text-[13px] font-medium text-[#1D2129] shadow-none hover:bg-[#E5E6EB] dark:bg-muted dark:text-foreground dark:hover:bg-muted/70" disabled={uploading}>
                          {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                          {t('dataCenterPage.toolbar.authorizeLocalFile')}
                          <ChevronDown className="ml-2 h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-[132px] rounded-[10px] p-2">
                        <DropdownMenuItem onSelect={() => { void handleAuthorizeLocal('file'); }} className="text-[13px]">
                          {t('dataCenterPage.toolbar.authorizeLocalFileOption')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => { void handleAuthorizeLocal('folder'); }} className="text-[13px]">
                          {t('dataCenterPage.toolbar.authorizeLocalFolderOption')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className={cn(workflowListToolbarClass, 'mb-[18px] shrink-0')}>
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
                      className="h-[34px] w-[300px] rounded-[10px] border border-[#E5E6EB] bg-white pl-9 pr-3 text-[13px] text-[#1D2129] outline-none placeholder:text-[#A8B0BD] focus:border-[#C9CDD4] focus:ring-0 dark:border-border dark:bg-background dark:text-foreground dark:placeholder:text-muted-foreground"
                    />
                  </div>
                  <AssociationFilterDropdown value={associationFilter} onChange={setAssociationFilter} />
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
                    className="h-[34px] rounded-[10px] border-0 bg-[#F2F3F5] px-3 text-[13px] font-medium text-[#1D2129] shadow-none hover:bg-[#E5E6EB] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-muted dark:text-foreground dark:hover:bg-muted/70"
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

            <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {currentError ? (
                <FeedbackState icon={<AlertCircle className="h-8 w-8" />} title={t('dataCenterPage.feedback.loadFailed')} description={errorDescription ?? ''} />
              ) : currentLoading ? (
                <FeedbackState icon={<Loader2 className="h-8 w-8 animate-spin" />} title={t('dataCenterPage.feedback.loadingTitle')} description={t('dataCenterPage.feedback.loadingDescription')} />
              ) : visibleItems.length === 0 ? (
                <FeedbackState
                  icon={<Folder className="h-8 w-8" />}
                  title={localPermissionDenied
                    ? t('dataCenterPage.feedback.localPermissionDeniedTitle')
                    : currentKeyword ? t('dataCenterPage.feedback.noMatch') : t('dataCenterPage.feedback.empty')}
                  description={localPermissionDenied
                    ? t('dataCenterPage.feedback.localPermissionDeniedDescription', { name: localPermissionDenied.name })
                    : emptyFeedbackDescription}
                />
              ) : currentViewMode === 'grid' ? (
                <>
                  <div className="min-h-0 flex-1">
                    <EntryGrid
                      items={visibleItems}
                      allowUploadToShared={isSite}
                      onOpenFolder={handleOpenFolder}
                      onPreview={handlePreview}
                      onDownload={handleDownload}
                      onShare={handleShare}
                      onUploadToShared={handleUploadToShared}
                      onMove={setMoveEntry}
                      onMoveToFolder={handleMoveToFolder}
                      onRename={setRenameEntry}
                      onDelete={setDeleteEntry}
                      onTrace={handleTrace}
                    />
                  </div>
                  <DataCenterLoadMoreFooter
                    loadingMore={store.loadingMore}
                    canLoadMore={canLoadMore}
                    onLoadMore={handleLoadMore}
                  />
                </>
              ) : (
                <>
                  <div className="min-h-0 flex-1">
                    <EntryList
                      items={visibleItems}
                      allowUploadToShared={isSite}
                      onOpenFolder={handleOpenFolder}
                      onPreview={handlePreview}
                      onDownload={handleDownload}
                      onShare={handleShare}
                      onUploadToShared={handleUploadToShared}
                      onMove={setMoveEntry}
                      onMoveToFolder={handleMoveToFolder}
                      onRename={setRenameEntry}
                      onDelete={setDeleteEntry}
                      onTrace={handleTrace}
                    />
                  </div>
                  <DataCenterLoadMoreFooter
                    loadingMore={store.loadingMore}
                    canLoadMore={canLoadMore}
                    onLoadMore={handleLoadMore}
                  />
                </>
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
          title={deleteDialogTitle}
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
                    toast.success(deleteSuccessMessage);
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : t('dataCenterPage.toasts.deleteFailed'));
                  }
                }}
              >
                {deleteConfirmLabel}
              </Button>
            </>
          )}
        >
          <p className="text-sm text-muted-foreground">
            {deleteDialogMessage}
          </p>
        </DataCenterModal>
      ) : null}

      {moveEntry ? (
        <MoveEntryDialog
          entry={moveEntry}
          onClose={() => setMoveEntry(null)}
          onConfirm={async (targetParentEntryId) => {
            try {
              await handleMoveEntry(moveEntry, targetParentEntryId);
              setMoveEntry(null);
              toast.success(t('dataCenterPage.toasts.moved'));
            } catch (error) {
              toast.error(error instanceof Error ? error.message : t('dataCenterPage.toasts.moveFailed'));
            }
          }}
        />
      ) : null}

      {previewState ? (
        <PreviewModal
          entry={previewState.entry}
          tempUrl={previewState.tempUrl}
          onClose={() => setPreviewState(null)}
          onRefresh={() => handleRefreshPreview(previewState.entry)}
          onDownload={() => handleDownload(previewState.entry)}
          onShare={() => handleShare(previewState.entry)}
          onUploadToShared={() => handleUploadToShared(previewState.entry)}
          allowUploadToShared={isSite}
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

      {traceMissingOpen ? (
        <TraceChatMissingDialog onClose={() => setTraceMissingOpen(false)} />
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

function DataCenterLoadMoreFooter({
  loadingMore,
  canLoadMore,
  onLoadMore,
}: {
  loadingMore: boolean;
  canLoadMore: boolean;
  onLoadMore: () => Promise<void>;
}) {
  const { t } = useTranslation('common');
  if (!canLoadMore) return null;
  return (
    <div className="flex shrink-0 items-center justify-center gap-3 border-t border-border/60 px-2 py-3 text-[12px] text-muted-foreground">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 rounded-[8px] px-3 text-[12px]"
        onClick={onLoadMore}
        disabled={loadingMore}
      >
        {loadingMore ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
        {loadingMore ? t('dataCenterPage.pagination.loadingMore') : t('dataCenterPage.pagination.loadMore')}
      </Button>
    </div>
  );
}

function AssociationFilterDropdown({
  value,
  onChange,
}: {
  value: AssociationFilter;
  onChange: (value: AssociationFilter) => void;
}) {
  const { t } = useTranslation('common');
  const label = value === 'task'
    ? t('dataCenterPage.toolbar.associationTask')
    : t('dataCenterPage.toolbar.associationAll');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-[34px] items-center justify-center rounded-[10px] border border-[#E5E6EB] bg-white px-3 text-[13px] font-normal text-[#4E5969] shadow-none outline-none ring-0 transition-colors hover:bg-[#F7F8FA] focus:border-[#E5E6EB] focus:outline-none focus:ring-0 focus-visible:border-[#E5E6EB] focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=open]:border-[#E5E6EB] dark:border-border dark:bg-background dark:text-muted-foreground dark:hover:bg-muted/50"
        >
          {t('dataCenterPage.toolbar.associationLabel', { value: label })}
          <ChevronDown className="ml-1 h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[104px] rounded-[10px] p-2">
        <DropdownMenuItem onSelect={() => onChange('all')} className="text-[13px]">
          {t('dataCenterPage.toolbar.associationAll')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onChange('task')} className="text-[13px]">
          {t('dataCenterPage.toolbar.associationTask')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
