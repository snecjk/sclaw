import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, ChevronRight, Info, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import directoryIcon from '@/assets/icons/directory.svg';
import { Button } from '@/components/ui/button';
import {
  getDataCenterSpaces,
  listDataCenterEntries,
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

interface SaveTarget {
  space: FolderSpace;
  parentEntryId: string;
}

function folderKey(space: FolderSpace, entryId: string): string {
  return `${space}:${entryId}`;
}

function isSiteSharedArtifactSpace(space: { spaceType?: string; scopeType?: string | null; displayName?: string }): boolean {
  return space.spaceType === 'site_shared_artifact'
    || space.scopeType === 'site'
    || space.displayName?.includes('网点共享产物') === true;
}

function hashStableKey(value: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

function createArtifactUploadIdempotencyKey(
  provenance: DataCenterArtifactProvenance,
  target: SaveTarget,
  targetSpaceId: string | null,
): string {
  const stableSource = [
    provenance.sourceType,
    provenance.sessionId,
    provenance.artifactKey,
    target.space,
    targetSpaceId ?? 'my',
    target.parentEntryId,
  ].join(':');
  return `artifact-${hashStableKey(stableSource)}`;
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
  const [sharedOpen, setSharedOpen] = useState(true);
  const [mineOpen, setMineOpen] = useState(true);

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
    if (nextOpen && folderMap[key] === undefined) {
      await loadFolders(space, entryId);
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

  if (!file) return null;

  const provenance = file.artifactProvenance;
  const canSave = Boolean(file.filePath && provenance?.sessionId && provenance.artifactKey);

  const save = async () => {
    if (!file.filePath || !provenance) return;
    setSaving(true);
    try {
      const targetSpaceId = selectedTarget.space === 'shared'
        ? sharedSpaceId ?? await loadSharedSpace()
        : null;
      if (selectedTarget.space === 'shared' && !targetSpaceId) {
        throw new Error(t('dataCenterPage.toasts.sharedSpaceUnavailable'));
      }
      const uploadProvenance = await resolveScheduledTaskArtifactProvenance(provenance);
      await uploadArtifactFromPath({
        ...uploadProvenance,
        filePath: file.filePath,
        fileName: file.fileName,
        parentEntryId: selectedTarget.space === 'my' ? selectedTarget.parentEntryId : ROOT_ENTRY_ID,
        targetSpaceId: targetSpaceId ?? undefined,
        targetParentEntryId: selectedTarget.space === 'shared' ? selectedTarget.parentEntryId : undefined,
        idempotencyKey: createArtifactUploadIdempotencyKey(uploadProvenance, selectedTarget, targetSpaceId),
      });
      toast.success(t('dataCenterPage.saveArtifact.saved'));
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('dataCenterPage.saveArtifact.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-4">
      <div className="w-full max-w-[414px] overflow-hidden rounded-[14px] border border-[#E5E6EB] bg-white shadow-2xl dark:border-border dark:bg-background">
        <div className="flex h-11 items-center justify-between px-4">
          <h2 className="text-[13px] font-semibold text-[#1D2129] dark:text-foreground">{t('dataCenterPage.saveArtifact.saveToDataCenterTitle')}</h2>
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

          <div className="mt-3 rounded-[14px] bg-[#F7F8FA] p-2 dark:bg-muted/40">
            {isSite ? (
              <div className="rounded-[10px] bg-white p-2.5 dark:bg-card">
                <TreeHeader
                  checked={selectedTarget.space === 'shared' && selectedTarget.parentEntryId === ROOT_ENTRY_ID}
                  open={sharedOpen}
                  onToggle={() => setSharedOpen((open) => !open)}
                  onCheck={() => setSelectedTarget({ space: 'shared', parentEntryId: ROOT_ENTRY_ID })}
                  onSelect={() => setSelectedTarget({ space: 'shared', parentEntryId: ROOT_ENTRY_ID })}
                  label={t('dataCenterPage.saveArtifact.sharedArtifacts')}
                />
                {sharedOpen ? (
                  <div className="mt-2 space-y-2 pl-5">
                    {sharedSpaceLoading || loadingMap[folderKey('shared', ROOT_ENTRY_ID)] ? (
                      <div className="flex items-center gap-2 px-1 py-2 text-[12px] text-[#86909C] dark:text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        {t('dataCenterPage.saveArtifact.loading')}
                      </div>
                    ) : (folderMap[folderKey('shared', ROOT_ENTRY_ID)] ?? []).length === 0 ? (
                      <div className="px-1 py-2 text-[12px] text-[#86909C] dark:text-muted-foreground">{t('dataCenterPage.saveArtifact.emptyFolders')}</div>
                    ) : (
                      (folderMap[folderKey('shared', ROOT_ENTRY_ID)] ?? []).map((folder) => (
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
                        />
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className={cn('rounded-[10px] bg-white p-2.5 dark:bg-card', isSite && 'mt-2')}>
              <TreeHeader
                checked={selectedTarget.space === 'my' && selectedTarget.parentEntryId === ROOT_ENTRY_ID}
                open={mineOpen}
                onToggle={() => setMineOpen((open) => !open)}
                onCheck={() => setSelectedTarget({ space: 'my', parentEntryId: ROOT_ENTRY_ID })}
                onSelect={() => setSelectedTarget({ space: 'my', parentEntryId: ROOT_ENTRY_ID })}
                label={t('dataCenterPage.saveArtifact.myArtifacts')}
              />
              {mineOpen ? (
                <div className="mt-2 space-y-2 pl-5">
                  {loadingMap[folderKey('my', ROOT_ENTRY_ID)] ? (
                    <div className="flex items-center gap-2 px-1 py-2 text-[12px] text-[#86909C] dark:text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t('dataCenterPage.saveArtifact.loading')}
                    </div>
                  ) : (folderMap[folderKey('my', ROOT_ENTRY_ID)] ?? []).length === 0 ? (
                    <div className="px-1 py-2 text-[12px] text-[#86909C] dark:text-muted-foreground">{t('dataCenterPage.saveArtifact.emptyFolders')}</div>
                  ) : (
                    (folderMap[folderKey('my', ROOT_ENTRY_ID)] ?? []).map((folder) => (
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
                      />
                    ))
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex h-[48px] justify-end gap-2 border-t border-[#E5E6EB] px-3 py-2 dark:border-border">
          <Button type="button" variant="outline" className="h-8 rounded-[8px] px-4 text-[12px] font-normal" onClick={onClose}>{t('actions.cancel')}</Button>
          <Button type="button" className="h-8 rounded-[8px] bg-[#1D2129] px-4 text-[12px] font-normal text-white hover:bg-[#4E5969] dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90" onClick={save} disabled={!canSave || saving}>
            {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            {t('actions.confirm')}
          </Button>
        </div>
      </div>
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
          : 'border-[#D7DBE2] bg-white dark:border-border dark:bg-background',
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
  label,
  onToggle,
  onCheck,
  onSelect,
}: {
  checked?: boolean;
  open: boolean;
  label: string;
  onToggle: () => void;
  onCheck?: () => void;
  onSelect?: () => void;
}) {
  return (
    <div className="flex h-7 items-center gap-2">
      <TreeCheckbox checked={checked} onClick={onCheck} />
      <button
        type="button"
        onClick={onToggle}
        className="flex h-5 w-5 items-center justify-center rounded text-[#4E5969] hover:bg-[#F2F3F5] dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-[6px] text-left"
      >
        <img src={directoryIcon} alt="" aria-hidden="true" className="h-5 w-5 shrink-0 object-contain dark:brightness-110" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#1D2129] dark:text-foreground">{label}</span>
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
}) {
  const currentKey = folderKey(space, folder.entryId);
  const childrenLoaded = folderMap[currentKey] !== undefined;
  const hasChildren = childrenFolders.length > 0;
  const showToggle = loading || !childrenLoaded || hasChildren;

  return (
    <div className="space-y-1">
      <div
        className="flex h-7 w-full items-center gap-2 rounded-[6px] text-left hover:bg-[#F7F8FA] dark:hover:bg-muted/50"
        style={{ paddingLeft: depth * 18 }}
      >
        <TreeCheckbox checked={checked} onClick={() => onSelect(folder.entryId)} />
        {showToggle ? (
          <button
            type="button"
            onClick={() => { void onToggleOpen(space, folder.entryId); }}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[#4E5969] hover:bg-[#F2F3F5] dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground"
            aria-label={folder.name}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="h-5 w-5 shrink-0" aria-hidden="true" />
        )}
        <button
          type="button"
          onClick={() => onSelect(folder.entryId)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-[6px] text-left"
        >
          <img src={directoryIcon} alt="" aria-hidden="true" className="h-5 w-5 shrink-0 object-contain dark:brightness-110" />
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[#1D2129] dark:text-foreground">{folder.name}</span>
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
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
