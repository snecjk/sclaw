import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Check, ChevronDown, ChevronRight, FileText, FolderPlus, Info, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import directoryIcon from '@/assets/icons/directory.svg';
import { Button } from '@/components/ui/button';
import {
  createDataCenterFolder,
  createDataCenterIdempotencyKey,
  deleteDataCenterEntry,
  deleteDataCenterSharedEntry,
  getDataCenterSpaces,
  listDataCenterEntries,
  renameDataCenterEntry,
  uploadArtifactFromPath,
} from '@/lib/data-center-api';
import { resolveScheduledTaskArtifactProvenance } from '@/lib/scheduled-task-artifact-provenance';
import { cn } from '@/lib/utils';
import { isSiteUser, useAuthStore } from '@/stores/auth';
import type { AttachedFileMeta } from '@/stores/chat';
import type { DataCenterArtifactProvenance, DataCenterEntry } from '@/types/data-center';

interface SaveArtifactDialogProps {
  file: AttachedFileMeta | null;
  onClose: () => void;
  onSaved: () => void;
}

const ROOT_ENTRY_ID = 'root';
type FolderMap = Record<string, DataCenterEntry[]>;
type LoadingMap = Record<string, boolean>;
type OpenMap = Record<string, boolean>;
type FolderSpace = 'my' | 'shared';
type ConflictAction = 'replace' | 'keep_both';

interface SaveTarget {
  space: FolderSpace;
  parentEntryId: string;
}

interface FileNameConflict {
  fileName: string;
  existingEntry: DataCenterEntry;
  existingNames: Set<string>;
}

function folderKey(space: FolderSpace, entryId: string): string {
  return `${space}:${entryId}`;
}

function isSiteSharedArtifactSpace(space: { spaceType?: string; scopeType?: string | null; displayName?: string }): boolean {
  return space.spaceType === 'site_shared_artifact'
    || space.scopeType === 'site'
    || space.displayName?.includes('网点共享产物') === true;
}

function normalizeFileNameKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function reserveUniqueFileName(requestedName: string, usedNames: Set<string>): string {
  const fallbackName = requestedName.trim() || 'file';
  const dotIndex = fallbackName.lastIndexOf('.');
  const hasExt = dotIndex > 0;
  const stem = hasExt ? fallbackName.slice(0, dotIndex) : fallbackName;
  const ext = hasExt ? fallbackName.slice(dotIndex) : '';
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${stem} (${index})${ext}`;
    if (!usedNames.has(normalizeFileNameKey(candidate))) {
      usedNames.add(normalizeFileNameKey(candidate));
      return candidate;
    }
  }
  const candidate = `${stem}-${Date.now()}${ext}`;
  usedNames.add(normalizeFileNameKey(candidate));
  return candidate;
}

export function SaveArtifactDialog({ file, onClose, onSaved }: SaveArtifactDialogProps) {
  const { t } = useTranslation('common');
  const authUser = useAuthStore((s) => s.user);
  const siteDepartmentTypes = useAuthStore((s) => s.siteDepartmentTypes);
  const isSite = siteDepartmentTypes !== null && isSiteUser(authUser?.categoryCode);
  const [selectedTarget, setSelectedTarget] = useState<SaveTarget>({ space: 'my', parentEntryId: ROOT_ENTRY_ID });
  const [sharedSpaceId, setSharedSpaceId] = useState<string | null>(null);
  const [sharedSpaceLoading, setSharedSpaceLoading] = useState(false);
  const [folderMap, setFolderMap] = useState<FolderMap>({});
  const [loadingMap, setLoadingMap] = useState<LoadingMap>({});
  const [openMap, setOpenMap] = useState<OpenMap>({});
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<FileNameConflict | null>(null);
  const [sharedOpen, setSharedOpen] = useState(true);
  const [mineOpen, setMineOpen] = useState(true);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ space: FolderSpace; folder: DataCenterEntry; x: number; y: number } | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<{ space: FolderSpace; folder: DataCenterEntry } | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const [deletingFolder, setDeletingFolder] = useState<{ space: FolderSpace; folder: DataCenterEntry } | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const loadSharedSpace = async (): Promise<string | null> => {
    if (sharedSpaceId) return sharedSpaceId;
    setSharedSpaceLoading(true);
    try {
      const result = await getDataCenterSpaces();
      const space = (result.spaces ?? []).find(isSiteSharedArtifactSpace);
      const nextSpaceId = space?.spaceId ?? null;
      setSharedSpaceId(nextSpaceId);
      return nextSpaceId;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('dataCenterPage.toasts.sharedSpaceLoadFailed'));
      return null;
    } finally {
      setSharedSpaceLoading(false);
    }
  };

  const fetchFolders = async (space: FolderSpace, entryId: string, spaceId: string | null) => {
    const result = await listDataCenterEntries({
      spaceType: space === 'shared' ? 'site_shared_artifact' : 'qa_artifact',
      spaceId: spaceId ?? undefined,
      parentEntryId: entryId,
      entryType: 'folder',
      pageSize: 200,
      sortField: 'name',
      sortOrder: 'asc',
    });
    return result.items.filter((item) => item.entryType === 'folder');
  };

  const loadFolders = async (space: FolderSpace, entryId = ROOT_ENTRY_ID, options: { preloadChildFolders?: boolean } = {}) => {
    const key = folderKey(space, entryId);
    setLoadingMap((prev) => ({ ...prev, [key]: true }));
    try {
      const spaceId = space === 'shared' ? await loadSharedSpace() : null;
      if (space === 'shared' && !spaceId) {
        setFolderMap((prev) => ({ ...prev, [key]: [] }));
        return;
      }
      const folders = await fetchFolders(space, entryId, spaceId);
      setFolderMap((prev) => ({
        ...prev,
        [key]: folders,
      }));
      if (options.preloadChildFolders && folders.length > 0) {
        const childKeys = folders.map((folder) => folderKey(space, folder.entryId));
        setLoadingMap((prev) => {
          const next = { ...prev };
          for (const childKey of childKeys) next[childKey] = true;
          return next;
        });
        const childResults = await Promise.all(
          folders.map(async (folder) => {
            try {
              return {
                key: folderKey(space, folder.entryId),
                folders: await fetchFolders(space, folder.entryId, spaceId),
              };
            } catch {
              return { key: folderKey(space, folder.entryId), folders: null };
            }
          }),
        );
        setFolderMap((prev) => {
          const next = { ...prev };
          for (const childResult of childResults) {
            if (childResult.folders === null) continue;
            next[childResult.key] = childResult.folders;
          }
          return next;
        });
        setLoadingMap((prev) => {
          const next = { ...prev };
          for (const childKey of childKeys) next[childKey] = false;
          return next;
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('dataCenterPage.saveArtifact.loadFoldersFailed'));
    } finally {
      setLoadingMap((prev) => ({ ...prev, [key]: false }));
    }
  };

  const toggleFolderOpen = async (space: FolderSpace, entryId: string) => {
    const key = folderKey(space, entryId);
    const nextOpen = !openMap[key];
    setOpenMap((prev) => ({ ...prev, [key]: nextOpen }));
    const childFolders = folderMap[key];
    const needsChildPreload = childFolders === undefined
      || childFolders.some((folder) => folderMap[folderKey(space, folder.entryId)] === undefined);
    if (nextOpen && needsChildPreload) {
      await loadFolders(space, entryId, { preloadChildFolders: true });
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadFolders('my', ROOT_ENTRY_ID, { preloadChildFolders: true });
    if (isSite) {
      void loadFolders('shared', ROOT_ENTRY_ID, { preloadChildFolders: true });
    }
    // The dialog is mounted only while open; initial state already points at root.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSite]);

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

  if (!file) return null;

  const provenance = file.artifactProvenance;
  const canSave = Boolean(file.filePath && provenance?.sessionId && provenance.artifactKey);
  const sharedRootKey = folderKey('shared', ROOT_ENTRY_ID);
  const myRootKey = folderKey('my', ROOT_ENTRY_ID);
  const sharedRootFolders = folderMap[sharedRootKey] ?? [];
  const myRootFolders = folderMap[myRootKey] ?? [];
  const sharedRootLoading = sharedSpaceLoading || Boolean(loadingMap[sharedRootKey]);
  const myRootLoading = Boolean(loadingMap[myRootKey]);

  const resolveTargetSpaceId = async (): Promise<string | null> => {
    if (selectedTarget.space !== 'shared') return null;
    const targetSpaceId = sharedSpaceId ?? await loadSharedSpace();
    if (!targetSpaceId) {
      throw new Error(t('dataCenterPage.toasts.sharedSpaceUnavailable'));
    }
    return targetSpaceId;
  };

  const closeCreateFolder = () => {
    if (createSubmitting) return;
    setCreatingFolder(false);
    setNewFolderName('');
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name || createSubmitting) return;
    setCreateSubmitting(true);
    try {
      const targetSpaceId = await resolveTargetSpaceId();
      const createdFolder = await createDataCenterFolder({
        spaceType: selectedTarget.space === 'shared' ? 'site_shared_artifact' : 'qa_artifact',
        spaceId: targetSpaceId ?? undefined,
        parentEntryId: selectedTarget.parentEntryId,
        name,
      });
      setCreatingFolder(false);
      setNewFolderName('');
      await loadFolders(selectedTarget.space, selectedTarget.parentEntryId);
      // A freshly created folder has no children; mark them as loaded-empty
      // so the row does not show an expand/collapse toggle.
      if (createdFolder?.entryId) {
        setFolderMap((prev) => ({ ...prev, [folderKey(selectedTarget.space, createdFolder.entryId)]: [] }));
      }
      if (selectedTarget.parentEntryId === ROOT_ENTRY_ID) {
        if (selectedTarget.space === 'shared') setSharedOpen(true);
        else setMineOpen(true);
      } else {
        setOpenMap((prev) => ({ ...prev, [folderKey(selectedTarget.space, selectedTarget.parentEntryId)]: true }));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('dataCenterPage.saveArtifact.createFolderFailed'));
    } finally {
      setCreateSubmitting(false);
    }
  };

  const findParentEntryId = (space: FolderSpace, entryId: string): string => {
    for (const [key, folders] of Object.entries(folderMap)) {
      if (!key.startsWith(`${space}:`)) continue;
      if (folders.some((folder) => folder.entryId === entryId)) {
        return key.slice(space.length + 1);
      }
    }
    return ROOT_ENTRY_ID;
  };

  const handleRenameFolder = async () => {
    const name = renameName.trim();
    if (!renamingFolder || !name || renameSubmitting) return;
    setRenameSubmitting(true);
    try {
      const parentEntryId = findParentEntryId(renamingFolder.space, renamingFolder.folder.entryId);
      await renameDataCenterEntry(renamingFolder.folder.entryId, name);
      setRenamingFolder(null);
      setRenameName('');
      toast.success(t('dataCenterPage.toasts.renamed'));
      await loadFolders(renamingFolder.space, parentEntryId, { preloadChildFolders: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('dataCenterPage.toasts.renameFailed'));
    } finally {
      setRenameSubmitting(false);
    }
  };

  const handleDeleteFolder = async () => {
    if (!deletingFolder || deleteSubmitting) return;
    setDeleteSubmitting(true);
    try {
      const { space, folder } = deletingFolder;
      const parentEntryId = findParentEntryId(space, folder.entryId);
      if (space === 'shared' && folder.shared && folder.canManage) {
        await deleteDataCenterSharedEntry(folder.entryId);
      } else {
        await deleteDataCenterEntry(folder.entryId);
      }
      if (selectedTarget.space === space && selectedTarget.parentEntryId === folder.entryId) {
        setSelectedTarget({ space, parentEntryId: ROOT_ENTRY_ID });
      }
      const deletedKey = folderKey(space, folder.entryId);
      setFolderMap((prev) => {
        const next = { ...prev };
        delete next[deletedKey];
        return next;
      });
      setOpenMap((prev) => {
        const next = { ...prev };
        delete next[deletedKey];
        return next;
      });
      setDeletingFolder(null);
      toast.success(t('dataCenterPage.toasts.deleted'));
      await loadFolders(space, parentEntryId, { preloadChildFolders: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('dataCenterPage.toasts.deleteFailed'));
    } finally {
      setDeleteSubmitting(false);
    }
  };

  const findFileNameConflict = async (
    fileName: string,
    targetSpaceId: string | null,
  ): Promise<FileNameConflict | null> => {
    const existingNames = new Set<string>();
    let existingEntry: DataCenterEntry | null = null;
    const requestedKey = normalizeFileNameKey(fileName);
    const pageSize = 200;
    for (let pageNo = 1; pageNo <= 50; pageNo += 1) {
      const result = await listDataCenterEntries({
        spaceType: selectedTarget.space === 'shared' ? 'site_shared_artifact' : 'qa_artifact',
        spaceId: targetSpaceId ?? undefined,
        parentEntryId: selectedTarget.parentEntryId,
        entryType: 'file',
        pageNo,
        pageSize,
        sortField: 'name',
        sortOrder: 'asc',
      });
      for (const item of result.items) {
        if (item.entryType !== 'file') continue;
        const key = normalizeFileNameKey(item.name);
        existingNames.add(key);
        if (key === requestedKey) existingEntry = item;
      }
      if (result.items.length < pageSize || result.pageNo * result.pageSize >= result.total) break;
    }
    return existingEntry ? { fileName, existingEntry, existingNames } : null;
  };

  const upload = async (
    uploadProvenance: DataCenterArtifactProvenance,
    targetSpaceId: string | null,
    fileName: string,
    idempotencyKey: string,
  ) => {
    if (!file.filePath) return;
    await uploadArtifactFromPath({
      ...uploadProvenance,
      filePath: file.filePath,
      fileName,
      parentEntryId: selectedTarget.space === 'my' ? selectedTarget.parentEntryId : ROOT_ENTRY_ID,
      targetSpaceId: targetSpaceId ?? undefined,
      targetParentEntryId: selectedTarget.space === 'shared' ? selectedTarget.parentEntryId : undefined,
      idempotencyKey,
    });
  };

  const completeSave = () => {
    toast.success(t('dataCenterPage.saveArtifact.saved'));
    onSaved();
  };

  const saveWithConflictAction = async (action: ConflictAction, currentConflict: FileNameConflict) => {
    if (!file.filePath || !provenance) return;
    setSaving(true);
    try {
      const targetSpaceId = await resolveTargetSpaceId();
      const uploadProvenance = await resolveScheduledTaskArtifactProvenance(provenance);
      if (action === 'replace') {
        if (selectedTarget.space === 'shared' && currentConflict.existingEntry.shared && currentConflict.existingEntry.canManage) {
          await deleteDataCenterSharedEntry(currentConflict.existingEntry.entryId);
        } else {
          await deleteDataCenterEntry(currentConflict.existingEntry.entryId);
        }
        await upload(
          uploadProvenance,
          targetSpaceId,
          currentConflict.fileName,
          createDataCenterIdempotencyKey('artifact-replace', `${uploadProvenance.artifactKey}:${currentConflict.fileName}`),
        );
      } else {
        const nextName = reserveUniqueFileName(currentConflict.fileName, new Set(currentConflict.existingNames));
        await upload(
          uploadProvenance,
          targetSpaceId,
          nextName,
          createDataCenterIdempotencyKey('artifact', `${uploadProvenance.artifactKey}:${nextName}`),
        );
      }
      setConflict(null);
      completeSave();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('dataCenterPage.saveArtifact.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (!file.filePath || !provenance) return;
    setSaving(true);
    try {
      const fileName = file.fileName?.trim() || 'file';
      const targetSpaceId = await resolveTargetSpaceId();
      const nameConflict = await findFileNameConflict(fileName, targetSpaceId);
      if (nameConflict) {
        setConflict(nameConflict);
        setSaving(false);
        return;
      }
      const uploadProvenance = await resolveScheduledTaskArtifactProvenance(provenance);
      await upload(
        uploadProvenance,
        targetSpaceId,
        fileName,
        createDataCenterIdempotencyKey('artifact', `${uploadProvenance.artifactKey}:${fileName}`),
      );
      completeSave();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('dataCenterPage.saveArtifact.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-4">
      <div className="w-full max-w-[414px] overflow-hidden rounded-[14px] border border-[#E5E6EB] bg-white shadow-2xl dark:border-[var(--sto-border-default)] dark:bg-[var(--sto-surface-elevated)]">
        <div className="flex h-11 items-center justify-between px-4">
          <h2 className="text-[13px] font-semibold text-[#1D2129] dark:text-[var(--sto-text-primary)]">{t('dataCenterPage.saveArtifact.saveToDataCenterTitle')}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[#4E5969] hover:bg-[#F2F3F5] hover:text-[#1D2129] dark:text-[var(--sto-text-secondary)] dark:hover:bg-[var(--sto-control-hover-bg)] dark:hover:text-[var(--sto-text-primary)]"
            aria-label={t('actions.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-3 pb-3">
          {isSite ? (
            <div className="flex min-h-[34px] items-start gap-2 rounded-[8px] border border-[#DCE7FF] bg-[#F2F6FF] px-2.5 py-2 text-[11px] leading-[17px] text-[#86909C] dark:border-blue-900/50 dark:bg-blue-950/25 dark:text-blue-100/80">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#4E7FFF]" />
              <span>{t('dataCenterPage.saveArtifact.sharedTip')}</span>
            </div>
          ) : null}

          {!canSave ? (
            <div className={cn(
              'rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200',
              isSite ? 'mt-3' : 'mt-0',
            )}>
              {t('dataCenterPage.saveArtifact.missingProvenance')}
            </div>
          ) : null}

          <div className="mt-3 rounded-[14px] bg-[#F7F8FA] p-2 dark:bg-[var(--sto-surface-primary)]">
            {isSite ? (
              <div className="rounded-[10px] bg-white p-2.5 dark:bg-[var(--sto-surface-secondary)]">
                <TreeHeader
                  checked={selectedTarget.space === 'shared' && selectedTarget.parentEntryId === ROOT_ENTRY_ID}
                  open={sharedOpen}
                  showToggle={sharedRootLoading || sharedRootFolders.length > 0}
                  onToggle={() => setSharedOpen((open) => !open)}
                  onCheck={() => setSelectedTarget({ space: 'shared', parentEntryId: ROOT_ENTRY_ID })}
                  onSelect={() => setSelectedTarget({ space: 'shared', parentEntryId: ROOT_ENTRY_ID })}
                  label={t('dataCenterPage.saveArtifact.sharedArtifacts')}
                />
                {sharedOpen ? (
                  <div className="mt-1.5 space-y-1 pl-[27px]">
                    {sharedRootLoading ? (
                      <div className="flex items-center gap-2 px-1 py-2 text-[12px] text-[#86909C] dark:text-[var(--sto-text-tertiary)]">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        {t('dataCenterPage.saveArtifact.loading')}
                      </div>
                    ) : sharedRootFolders.length > 0 ? (
                      sharedRootFolders.map((folder) => (
                        <TreeFolderRow
                          key={folder.entryId}
                          space="shared"
                          folder={folder}
                          checked={selectedTarget.space === 'shared' && selectedTarget.parentEntryId === folder.entryId}
                          depth={0}
                          open={Boolean(openMap[folderKey('shared', folder.entryId)])}
                          loading={Boolean(loadingMap[folderKey('shared', folder.entryId)])}
                          childrenFolders={folderMap[folderKey('shared', folder.entryId)] ?? []}
                          openMap={openMap}
                          loadingMap={loadingMap}
                          folderMap={folderMap}
                          selectedTarget={selectedTarget}
                          onSelect={(parentEntryId) => setSelectedTarget({ space: 'shared', parentEntryId })}
                          onToggleOpen={toggleFolderOpen}
                          onContextMenu={(space, folder, x, y) => setContextMenu({ space, folder, x, y })}
                        />
                      ))
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className={cn('rounded-[10px] bg-white p-2.5 dark:bg-[var(--sto-surface-secondary)]', isSite && 'mt-2')}>
              <TreeHeader
                checked={selectedTarget.space === 'my' && selectedTarget.parentEntryId === ROOT_ENTRY_ID}
                open={mineOpen}
                showToggle={myRootLoading || myRootFolders.length > 0}
                onToggle={() => setMineOpen((open) => !open)}
                onCheck={() => setSelectedTarget({ space: 'my', parentEntryId: ROOT_ENTRY_ID })}
                onSelect={() => setSelectedTarget({ space: 'my', parentEntryId: ROOT_ENTRY_ID })}
                label={t('dataCenterPage.saveArtifact.myArtifacts')}
              />
              {mineOpen ? (
                <div className="mt-1.5 space-y-1 pl-[27px]">
                  {myRootLoading ? (
                    <div className="flex items-center gap-2 px-1 py-2 text-[12px] text-[#86909C] dark:text-[var(--sto-text-tertiary)]">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t('dataCenterPage.saveArtifact.loading')}
                    </div>
                  ) : myRootFolders.length > 0 ? (
                    myRootFolders.map((folder) => (
                      <TreeFolderRow
                        key={folder.entryId}
                        space="my"
                        folder={folder}
                        checked={selectedTarget.space === 'my' && selectedTarget.parentEntryId === folder.entryId}
                        depth={0}
                        open={Boolean(openMap[folderKey('my', folder.entryId)])}
                        loading={Boolean(loadingMap[folderKey('my', folder.entryId)])}
                        childrenFolders={folderMap[folderKey('my', folder.entryId)] ?? []}
                        openMap={openMap}
                        loadingMap={loadingMap}
                        folderMap={folderMap}
                        selectedTarget={selectedTarget}
                        onSelect={(parentEntryId) => setSelectedTarget({ space: 'my', parentEntryId })}
                        onToggleOpen={toggleFolderOpen}
                        onContextMenu={(space, folder, x, y) => setContextMenu({ space, folder, x, y })}
                      />
                    ))
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex h-[48px] items-center justify-between gap-2 border-t border-[#E5E6EB] px-3 py-2 dark:border-[var(--sto-border-default)]">
          <button
            type="button"
            onClick={() => setCreatingFolder(true)}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] px-2 text-[12px] font-normal text-[#4E5969] hover:bg-[#F2F3F5] hover:text-[#1D2129] dark:text-[var(--sto-text-secondary)] dark:hover:bg-[var(--sto-control-hover-bg)] dark:hover:text-[var(--sto-text-primary)]"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            {t('dataCenterPage.saveArtifact.createFolderPlaceholder')}
          </button>
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="outline" className="h-8 rounded-[8px] px-4 text-[12px] font-normal" onClick={onClose}>{t('actions.cancel')}</Button>
            <Button type="button" className="h-8 rounded-[8px] bg-[#1D2129] px-4 text-[12px] font-normal text-white hover:bg-[#4E5969] dark:bg-[var(--sto-dialog-action-background)] dark:text-[var(--sto-dialog-action-foreground)] dark:hover:bg-[var(--sto-dialog-action-hover-background)]" onClick={save} disabled={!canSave || saving}>
              {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
              {t('actions.confirm')}
            </Button>
          </div>
        </div>
      </div>
      {creatingFolder ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 px-4"
          onClick={closeCreateFolder}
        >
          <div
            className="w-full max-w-[360px] rounded-[14px] border border-[#E5E6EB] bg-white p-4 shadow-2xl dark:border-[var(--sto-border-default)] dark:bg-[var(--sto-surface-elevated)]"
            onClick={(event) => event.stopPropagation()}
          >
            <h4 className="text-[13px] font-semibold text-[#1D2129] dark:text-[var(--sto-text-primary)]">{t('dataCenterPage.dialogs.createFolderTitle')}</h4>
            <input
              autoFocus
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleCreateFolder();
                if (event.key === 'Escape') closeCreateFolder();
              }}
              placeholder={t('dataCenterPage.dialogs.folderName')}
              className="mt-3 h-9 w-full rounded-[8px] border border-[#E5E6EB] bg-white px-3 text-[13px] outline-none focus:border-[#1D2129] dark:border-[var(--sto-border-default)] dark:bg-[var(--sto-control-bg)] dark:text-[var(--sto-text-primary)] dark:focus:border-[var(--sto-border-heavy)]"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={createSubmitting}
                onClick={closeCreateFolder}
                className="h-8 rounded-[8px] px-4 text-[12px] font-normal"
              >
                {t('actions.cancel')}
              </Button>
              <Button
                type="button"
                onClick={() => void handleCreateFolder()}
                disabled={!newFolderName.trim() || createSubmitting}
                className="h-8 rounded-[8px] bg-[#1D2129] px-4 text-[12px] font-normal text-white hover:bg-[#4E5969] dark:bg-[var(--sto-dialog-action-background)] dark:text-[var(--sto-dialog-action-foreground)] dark:hover:bg-[var(--sto-dialog-action-hover-background)]"
              >
                {createSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('dataCenterPage.saveArtifact.create')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {contextMenu ? (
        <div
          className="fixed z-[95] min-w-[128px] rounded-[10px] border border-[#E5E6EB] bg-white p-2 text-[#1D2129] shadow-[0_8px_24px_rgba(15,23,42,0.14)] dark:border-[var(--sto-border-default)] dark:bg-[var(--sto-surface-elevated)] dark:text-[var(--sto-text-primary)]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            className="block h-9 w-full rounded-[6px] px-3 text-left text-[13px] leading-9 hover:bg-[#F2F3F5] dark:hover:bg-[var(--sto-control-hover-bg)]"
            onClick={() => {
              setContextMenu(null);
              setRenamingFolder({ space: contextMenu.space, folder: contextMenu.folder });
              setRenameName(contextMenu.folder.name);
            }}
          >
            {t('dataCenterPage.menu.rename')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="block h-9 w-full rounded-[6px] px-3 text-left text-[13px] leading-9 text-[#F53F3F] hover:bg-[#F2F3F5] dark:text-destructive dark:hover:bg-[var(--sto-control-hover-bg)]"
            onClick={() => {
              setContextMenu(null);
              setDeletingFolder({ space: contextMenu.space, folder: contextMenu.folder });
            }}
          >
            {t('dataCenterPage.menu.delete')}
          </button>
        </div>
      ) : null}
      {renamingFolder ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 px-4"
          onClick={() => {
            if (renameSubmitting) return;
            setRenamingFolder(null);
            setRenameName('');
          }}
        >
          <div
            className="w-full max-w-[360px] rounded-[14px] border border-[#E5E6EB] bg-white p-4 shadow-2xl dark:border-[var(--sto-border-default)] dark:bg-[var(--sto-surface-elevated)]"
            onClick={(event) => event.stopPropagation()}
          >
            <h4 className="text-[13px] font-semibold text-[#1D2129] dark:text-[var(--sto-text-primary)]">{t('dataCenterPage.dialogs.renameTitle')}</h4>
            <input
              autoFocus
              value={renameName}
              onChange={(event) => setRenameName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleRenameFolder();
                if (event.key === 'Escape' && !renameSubmitting) {
                  setRenamingFolder(null);
                  setRenameName('');
                }
              }}
              placeholder={t('dataCenterPage.dialogs.folderName')}
              className="mt-3 h-9 w-full rounded-[8px] border border-[#E5E6EB] bg-white px-3 text-[13px] outline-none focus:border-[#1D2129] dark:border-[var(--sto-border-default)] dark:bg-[var(--sto-control-bg)] dark:text-[var(--sto-text-primary)] dark:focus:border-[var(--sto-border-heavy)]"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={renameSubmitting}
                onClick={() => {
                  setRenamingFolder(null);
                  setRenameName('');
                }}
                className="h-8 rounded-[8px] px-4 text-[12px] font-normal"
              >
                {t('actions.cancel')}
              </Button>
              <Button
                type="button"
                onClick={() => void handleRenameFolder()}
                disabled={!renameName.trim() || renameSubmitting}
                className="h-8 rounded-[8px] bg-[#1D2129] px-4 text-[12px] font-normal text-white hover:bg-[#4E5969] dark:bg-[var(--sto-dialog-action-background)] dark:text-[var(--sto-dialog-action-foreground)] dark:hover:bg-[var(--sto-dialog-action-hover-background)]"
              >
                {renameSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('actions.confirm')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {deletingFolder ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 px-4"
          onClick={() => {
            if (!deleteSubmitting) setDeletingFolder(null);
          }}
        >
          <div
            className="w-full max-w-[360px] rounded-[14px] border border-[#E5E6EB] bg-white p-4 shadow-2xl dark:border-[var(--sto-border-default)] dark:bg-[var(--sto-surface-elevated)]"
            onClick={(event) => event.stopPropagation()}
          >
            <h4 className="text-[13px] font-semibold text-[#1D2129] dark:text-[var(--sto-text-primary)]">{t('dataCenterPage.dialogs.deleteTitle')}</h4>
            <p className="mt-3 text-[12px] leading-[18px] text-[#4E5969] dark:text-[var(--sto-text-secondary)]">
              {t('dataCenterPage.dialogs.deleteMessage', { name: deletingFolder.folder.name })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={deleteSubmitting}
                onClick={() => setDeletingFolder(null)}
                className="h-8 rounded-[8px] px-4 text-[12px] font-normal"
              >
                {t('actions.cancel')}
              </Button>
              <Button
                type="button"
                onClick={() => void handleDeleteFolder()}
                disabled={deleteSubmitting}
                className="h-8 rounded-[8px] bg-[#F53F3F] px-4 text-[12px] font-normal text-white hover:bg-[#E23B3B] dark:bg-destructive dark:hover:bg-destructive/90"
              >
                {deleteSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('dataCenterPage.menu.delete')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {conflict ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 px-4">
          <div className="w-full max-w-[414px] overflow-hidden rounded-[14px] border border-[#E5E6EB] bg-white shadow-2xl dark:border-[var(--sto-border-default)] dark:bg-[var(--sto-surface-elevated)]">
            <div className="flex h-11 items-center justify-between px-4">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#FF4D4F] text-white">
                  <AlertCircle className="h-3.5 w-3.5" strokeWidth={2.8} />
                </span>
                <h3 className="truncate text-[13px] font-semibold text-[#1D2129] dark:text-[var(--sto-text-primary)]">
                  {t('dataCenterPage.saveArtifact.conflictTitle')}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setConflict(null)}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#4E5969] hover:bg-[#F2F3F5] hover:text-[#1D2129] dark:text-[var(--sto-text-secondary)] dark:hover:bg-[var(--sto-control-hover-bg)] dark:hover:text-[var(--sto-text-primary)]"
                aria-label={t('actions.close')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-3 pb-3">
              <p className="text-[12px] leading-[18px] text-[#4E5969] dark:text-[var(--sto-text-secondary)]">
                {t('dataCenterPage.saveArtifact.conflictDescription')}
              </p>
              <div className="mt-3 flex min-h-[44px] items-center gap-3 rounded-[10px] bg-[#F7F8FA] px-3 dark:bg-[var(--sto-surface-secondary)]">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[#3BAFB8] text-white">
                  <FileText className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#1D2129] dark:text-[var(--sto-text-primary)]">
                  {conflict.fileName}
                </span>
              </div>
            </div>
            <div className="flex h-[48px] items-center justify-between gap-2 border-t border-[#E5E6EB] px-3 py-2 dark:border-[var(--sto-border-default)]">
              <button
                type="button"
                className="h-8 rounded-[8px] px-3 text-[12px] font-normal text-[#1D2129] hover:bg-[#F2F3F5] dark:text-[var(--sto-text-primary)] dark:hover:bg-[var(--sto-control-hover-bg)]"
                onClick={() => {
                  setConflict(null);
                  onClose();
                }}
              >
                {t('dataCenterPage.saveArtifact.conflictSkip')}
              </button>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  className="h-8 rounded-[8px] bg-[#E5E6EB] px-4 text-[12px] font-normal text-[#1D2129] hover:bg-[#D7DBE2] dark:bg-[var(--sto-control-active-bg)] dark:text-[var(--sto-text-primary)] dark:hover:bg-[var(--sto-control-hover-bg)]"
                  disabled={saving}
                  onClick={() => { void saveWithConflictAction('replace', conflict); }}
                >
                  {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                  {t('dataCenterPage.saveArtifact.conflictReplace')}
                </Button>
                <Button
                  type="button"
                  className="h-8 rounded-[8px] bg-[#1D2129] px-4 text-[12px] font-normal text-white hover:bg-[#4E5969] dark:bg-[var(--sto-dialog-action-background)] dark:text-[var(--sto-dialog-action-foreground)] dark:hover:bg-[var(--sto-dialog-action-hover-background)]"
                  disabled={saving}
                  onClick={() => { void saveWithConflictAction('keep_both', conflict); }}
                >
                  {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                  {t('dataCenterPage.saveArtifact.conflictKeepBoth')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TreeCheckbox({ checked, disabled = false, onClick }: { checked?: boolean; disabled?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      className={cn(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border text-white transition-colors',
        checked
          ? 'border-[#1D2129] bg-[#1D2129] dark:border-primary dark:bg-primary'
          : 'border-[#D7DBE2] bg-white dark:border-[var(--sto-border-default)] dark:bg-[var(--sto-control-bg)]',
        disabled && 'cursor-not-allowed opacity-45',
      )}
      aria-pressed={Boolean(checked)}
    >
      {checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
    </button>
  );
}

function TreeHeader({
  checked,
  open,
  showToggle,
  label,
  onToggle,
  onCheck,
  onSelect,
}: {
  checked?: boolean;
  open: boolean;
  showToggle: boolean;
  label: string;
  onToggle: () => void;
  onCheck?: () => void;
  onSelect?: () => void;
}) {
  return (
    <div className="flex h-7 items-center gap-[10px]">
      <TreeCheckbox checked={checked} onClick={onCheck} />
      {showToggle ? (
        <button
          type="button"
          onClick={onToggle}
          className="flex h-4 w-4 items-center justify-center rounded text-[#4E5969] hover:bg-[#F2F3F5] dark:text-[var(--sto-text-secondary)] dark:hover:bg-[var(--sto-control-hover-bg)] dark:hover:text-[var(--sto-text-primary)]"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-[10px] rounded-[6px] text-left"
      >
        <img src={directoryIcon} alt="" aria-hidden="true" className="h-5 w-5 shrink-0 object-contain dark:brightness-110" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#1D2129] dark:text-[var(--sto-text-primary)]">{label}</span>
      </button>
    </div>
  );
}

function TreeFolderRow({
  space,
  folder,
  checked,
  depth,
  open,
  loading,
  childrenFolders,
  openMap,
  loadingMap,
  folderMap,
  selectedTarget,
  onSelect,
  onToggleOpen,
  onContextMenu,
}: {
  space: FolderSpace;
  folder: DataCenterEntry;
  checked?: boolean;
  depth: number;
  open: boolean;
  loading: boolean;
  childrenFolders: DataCenterEntry[];
  openMap: OpenMap;
  loadingMap: LoadingMap;
  folderMap: FolderMap;
  selectedTarget: SaveTarget;
  onSelect: (entryId: string) => void;
  onToggleOpen: (space: FolderSpace, entryId: string) => Promise<void>;
  onContextMenu: (space: FolderSpace, folder: DataCenterEntry, x: number, y: number) => void;
}) {
  const currentKey = folderKey(space, folder.entryId);
  const childrenLoaded = folderMap[currentKey] !== undefined;
  const hasChildren = childrenFolders.length > 0;
  const showToggle = loading || !childrenLoaded || hasChildren;

  return (
    <div className="space-y-1">
      <div
        className="flex h-7 w-full items-center gap-[10px] rounded-[6px] text-left hover:bg-[#F7F8FA] dark:hover:bg-[var(--sto-control-hover-bg)]"
        style={{ paddingLeft: depth * 27 }}
        onContextMenu={(event) => {
          event.preventDefault();
          onContextMenu(space, folder, event.clientX, event.clientY);
        }}
      >
        <TreeCheckbox checked={checked} onClick={() => onSelect(folder.entryId)} />
        {showToggle ? (
          <button
            type="button"
            onClick={() => { void onToggleOpen(space, folder.entryId); }}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[#4E5969] hover:bg-[#F2F3F5] dark:text-[var(--sto-text-secondary)] dark:hover:bg-[var(--sto-control-hover-bg)] dark:hover:text-[var(--sto-text-primary)]"
            aria-label={folder.name}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onSelect(folder.entryId)}
          className="flex min-w-0 flex-1 items-center gap-[10px] rounded-[6px] text-left"
        >
          <img src={directoryIcon} alt="" aria-hidden="true" className="h-5 w-5 shrink-0 object-contain dark:brightness-110" />
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[#1D2129] dark:text-[var(--sto-text-primary)]">{folder.name}</span>
        </button>
      </div>
      {open && childrenFolders.length > 0 ? (
        <div className="space-y-1">
          {childrenFolders.map((child) => (
            <TreeFolderRow
              key={child.entryId}
              space={space}
              folder={child}
              checked={selectedTarget.space === space && selectedTarget.parentEntryId === child.entryId}
              depth={depth + 1}
              open={Boolean(openMap[folderKey(space, child.entryId)])}
              loading={Boolean(loadingMap[folderKey(space, child.entryId)])}
              childrenFolders={folderMap[folderKey(space, child.entryId)] ?? []}
              openMap={openMap}
              loadingMap={loadingMap}
              folderMap={folderMap}
              selectedTarget={selectedTarget}
              onSelect={onSelect}
              onToggleOpen={onToggleOpen}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
