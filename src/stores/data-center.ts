import { create } from 'zustand';
import {
  createDataCenterFolder,
  deleteDataCenterEntry,
  getDataCenterQuota,
  getDataCenterSpaces,
  listDataCenterEntries,
  renameDataCenterEntry,
} from '@/lib/data-center-api';
import { hostApiFetch } from '@/lib/host-api';
import { getScheduledTaskIdFromSessionKey } from '@/lib/scheduled-task-artifact-provenance';
import type {
  DataCenterBreadcrumb,
  DataCenterEntry,
  DataCenterQuota,
  DataCenterSortField,
  DataCenterSortOrder,
  DataCenterSpace,
  DataCenterSpaceType,
  DataCenterViewMode,
} from '@/types/data-center';
import type { ScheduleTask } from '@/types/scheduled-task';

export type DataCenterSection = 'qa_artifact' | 'drive' | 'data_source';

interface DataCenterStoreState {
  section: DataCenterSection;
  spaceType: DataCenterSpaceType;
  spaceId: string | null;
  sharedSpaces: DataCenterSpace[];
  sharedSpacesLoading: boolean;
  parentEntryId: string;
  breadcrumbs: DataCenterBreadcrumb[];
  items: DataCenterEntry[];
  total: number;
  hasMore: boolean;
  pageNo: number;
  pageSize: number;
  keyword: string;
  sortField: DataCenterSortField;
  sortOrder: DataCenterSortOrder;
  viewMode: DataCenterViewMode;
  quota: DataCenterQuota | null;
  loading: boolean;
  loadingMore: boolean;
  mutating: boolean;
  error: string | null;
  setSection: (section: DataCenterSection) => void;
  setQaArtifactSpace: (spaceType: 'qa_artifact' | 'site_shared_artifact', spaceId?: string | null) => void;
  setViewMode: (viewMode: DataCenterViewMode) => void;
  setKeyword: (keyword: string) => void;
  setSort: (sortField: DataCenterSortField, sortOrder: DataCenterSortOrder) => void;
  load: (options?: { resetPage?: boolean }) => Promise<void>;
  loadMore: () => Promise<void>;
  loadSharedSpaces: () => Promise<DataCenterSpace[]>;
  refreshQuota: () => Promise<void>;
  enterFolder: (entry: DataCenterEntry) => Promise<void>;
  openBreadcrumb: (entryId: string) => Promise<void>;
  createFolder: (name: string) => Promise<void>;
  renameEntry: (entryId: string, name: string) => Promise<void>;
  deleteEntry: (entryId: string) => Promise<void>;
}

function isSameLoadTarget(
  current: DataCenterStoreState,
  requested: DataCenterStoreState,
  requestedPageNo: number,
): boolean {
  return current.section === requested.section
    && current.spaceType === requested.spaceType
    && current.spaceId === requested.spaceId
    && current.parentEntryId === requested.parentEntryId
    && current.keyword === requested.keyword
    && current.pageNo === requestedPageNo
    && current.pageSize === requested.pageSize
    && current.sortField === requested.sortField
    && current.sortOrder === requested.sortOrder;
}

function isSameListTarget(
  current: DataCenterStoreState,
  requested: DataCenterStoreState,
): boolean {
  return current.section === requested.section
    && current.spaceType === requested.spaceType
    && current.spaceId === requested.spaceId
    && current.parentEntryId === requested.parentEntryId
    && current.keyword === requested.keyword
    && current.pageSize === requested.pageSize
    && current.sortField === requested.sortField
    && current.sortOrder === requested.sortOrder;
}

function belongsToRequestedSpace(entry: DataCenterEntry, requested: DataCenterStoreState): boolean {
  if (entry.spaceType !== requested.spaceType) return false;
  if (requested.spaceType !== 'site_shared_artifact') return true;
  return !requested.spaceId || entry.spaceId === requested.spaceId;
}

function sectionToSpace(section: DataCenterSection): DataCenterSpaceType {
  return section === 'drive' ? 'drive' : 'qa_artifact';
}

function isSiteSharedArtifactSpace(space: DataCenterSpace): boolean {
  const rawSpaceType = (space as { spaceType?: string }).spaceType;
  return rawSpaceType === 'site_shared_artifact'
    || space.scopeType === 'site'
    || space.displayName.includes('网点共享产物');
}

interface ArtifactSaveRecord {
  sourceType: string;
  sourceTitle: string | null;
  runId: string | null;
  artifactName: string;
  dataCenterEntryId: string | null;
}

async function enrichScheduledTaskEntryTitles(items: DataCenterEntry[]): Promise<DataCenterEntry[]> {
  const scheduledItems = items.filter((item) => item.sourceType === 'scheduled_task_artifact' && !item.sourceTitle?.trim());
  if (scheduledItems.length === 0) return items;

  try {
    const records = await hostApiFetch<ArtifactSaveRecord[]>('/api/artifact-save-records?sourceType=scheduled_task_artifact&limit=500');
    const byEntryId = new Map<string, ArtifactSaveRecord>();
    const byRunAndName = new Map<string, ArtifactSaveRecord>();
    const tasks = await hostApiFetch<ScheduleTask[]>('/api/scheduled-tasks').catch(() => [] as ScheduleTask[]);
    const titleByTaskId = new Map(tasks.map((task) => [task.id, task.name]));

    for (const record of records) {
      if (!record.sourceTitle?.trim()) continue;
      if (record.dataCenterEntryId) {
        byEntryId.set(record.dataCenterEntryId, record);
      }
      if (record.runId && record.artifactName) {
        byRunAndName.set(`${record.runId}:${record.artifactName}`, record);
      }
    }

    return items.map((item) => {
      if (item.sourceType !== 'scheduled_task_artifact' || item.sourceTitle?.trim()) return item;
      const record = byEntryId.get(item.entryId)
        ?? (item.runId ? byRunAndName.get(`${item.runId}:${item.name}`) : undefined);
      const taskId = item.sourceId?.trim() || (item.sessionId ? getScheduledTaskIdFromSessionKey(item.sessionId) : null);
      const sourceTitle = record?.sourceTitle?.trim() || (taskId ? titleByTaskId.get(taskId)?.trim() : undefined);
      return sourceTitle ? { ...item, sourceTitle } : item;
    });
  } catch {
    return items;
  }
}

export const useDataCenterStore = create<DataCenterStoreState>((set, get) => ({
  section: 'qa_artifact',
  spaceType: 'qa_artifact',
  spaceId: null,
  sharedSpaces: [],
  sharedSpacesLoading: false,
  parentEntryId: 'root',
  breadcrumbs: [],
  items: [],
  total: 0,
  hasMore: false,
  pageNo: 1,
  pageSize: 50,
  keyword: '',
  sortField: 'updatedAt',
  sortOrder: 'desc',
  viewMode: 'list',
  quota: null,
  loading: false,
  loadingMore: false,
  mutating: false,
  error: null,

  setSection: (section) => {
    set({
      section,
      spaceType: sectionToSpace(section),
      spaceId: null,
      parentEntryId: 'root',
      breadcrumbs: [],
      items: [],
      total: 0,
      hasMore: false,
      pageNo: 1,
      keyword: '',
      loadingMore: false,
      error: null,
    });
  },

  setQaArtifactSpace: (spaceType, spaceId = null) => {
    set((state) => {
      const nextSpaceId = spaceType === 'site_shared_artifact' ? spaceId : null;
      const alreadyAtTargetRoot = state.section === 'qa_artifact'
        && state.spaceType === spaceType
        && state.spaceId === nextSpaceId
        && state.parentEntryId === 'root'
        && state.keyword === '';

      if (alreadyAtTargetRoot) {
        return { error: null };
      }

      return {
        section: 'qa_artifact',
        spaceType,
        spaceId: nextSpaceId,
        parentEntryId: 'root',
        breadcrumbs: [],
        items: [],
        total: 0,
        hasMore: false,
        pageNo: 1,
        keyword: '',
        loadingMore: false,
        error: null,
      };
    });
  },

  setViewMode: (viewMode) => set({ viewMode }),
  setKeyword: (keyword) => set({ keyword, pageNo: 1 }),
  setSort: (sortField, sortOrder) => set({ sortField, sortOrder, pageNo: 1 }),

  load: async (options) => {
    const state = get();
    if (state.section === 'data_source') return;
    if (state.spaceType === 'site_shared_artifact' && !state.spaceId) {
      set({
        items: [],
        total: 0,
        hasMore: false,
        pageNo: 1,
        breadcrumbs: [],
        loading: false,
        loadingMore: false,
        error: null,
      });
      return;
    }
    const pageNo = options?.resetPage ? 1 : state.pageNo;
    set({ loading: true, loadingMore: false, error: null, pageNo });
    try {
      const result = await listDataCenterEntries({
        spaceType: state.spaceType,
        spaceId: state.spaceId ?? undefined,
        parentEntryId: state.parentEntryId,
        keyword: state.keyword,
        pageNo,
        pageSize: state.pageSize,
        sortField: state.sortField,
        sortOrder: state.sortOrder,
      });
      const spaceItems = result.items.filter((item) => belongsToRequestedSpace(item, state));
      const items = await enrichScheduledTaskEntryTitles(spaceItems);
      if (!isSameLoadTarget(get(), state, pageNo)) return;
      set({
        items,
        total: result.total,
        hasMore: result.items.length > 0 && result.pageNo * result.pageSize < result.total,
        pageNo: result.pageNo,
        pageSize: result.pageSize,
        breadcrumbs: result.breadcrumbs ?? [],
        loading: false,
        loadingMore: false,
      });
    } catch (error) {
      if (!isSameLoadTarget(get(), state, pageNo)) return;
      set({ loading: false, loadingMore: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  loadMore: async () => {
    const state = get();
    if (state.section === 'data_source') return;
    if (state.loading || state.loadingMore) return;
    if (state.spaceType === 'site_shared_artifact' && !state.spaceId) return;
    if (!state.hasMore) return;

    const nextPageNo = state.pageNo + 1;
    set({ loadingMore: true, error: null });
    try {
      const result = await listDataCenterEntries({
        spaceType: state.spaceType,
        spaceId: state.spaceId ?? undefined,
        parentEntryId: state.parentEntryId,
        keyword: state.keyword,
        pageNo: nextPageNo,
        pageSize: state.pageSize,
        sortField: state.sortField,
        sortOrder: state.sortOrder,
      });
      const spaceItems = result.items.filter((item) => belongsToRequestedSpace(item, state));
      const items = await enrichScheduledTaskEntryTitles(spaceItems);
      if (!isSameListTarget(get(), state)) {
        set({ loadingMore: false });
        return;
      }
      set((current) => ({
        items: [...current.items, ...items],
        total: result.total,
        hasMore: result.items.length > 0 && result.pageNo * result.pageSize < result.total,
        pageNo: result.pageNo,
        pageSize: result.pageSize,
        breadcrumbs: result.breadcrumbs ?? current.breadcrumbs,
        loadingMore: false,
      }));
    } catch (error) {
      if (!isSameListTarget(get(), state)) {
        set({ loadingMore: false });
        return;
      }
      set({ loadingMore: false });
      throw error;
    }
  },

  loadSharedSpaces: async () => {
    set({ sharedSpacesLoading: true });
    try {
      const result = await getDataCenterSpaces();
      const spaces = (result.spaces ?? []).filter(isSiteSharedArtifactSpace);
      set((state) => ({
        sharedSpaces: spaces,
        sharedSpacesLoading: false,
        spaceId: state.spaceType === 'site_shared_artifact'
          ? state.spaceId ?? spaces[0]?.spaceId ?? null
          : state.spaceId,
      }));
      return spaces;
    } catch (error) {
      set({ sharedSpacesLoading: false });
      throw error;
    }
  },

  refreshQuota: async () => {
    try {
      const quota = await getDataCenterQuota();
      set({ quota });
    } catch {
      set({ quota: null });
    }
  },

  enterFolder: async (entry) => {
    if (entry.entryType !== 'folder') return;
    set({ parentEntryId: entry.entryId, keyword: '', pageNo: 1 });
    await get().load({ resetPage: true });
  },

  openBreadcrumb: async (entryId) => {
    set({ parentEntryId: entryId || 'root', keyword: '', pageNo: 1 });
    await get().load({ resetPage: true });
  },

  createFolder: async (name) => {
    const state = get();
    set({ mutating: true, error: null });
    try {
      await createDataCenterFolder({
        spaceType: state.spaceType,
        spaceId: state.spaceId ?? undefined,
        parentEntryId: state.parentEntryId,
        name,
      });
      set({ mutating: false });
      await get().load();
    } catch (error) {
      set({ mutating: false });
      throw error;
    }
  },

  renameEntry: async (entryId, name) => {
    set({ mutating: true, error: null });
    try {
      await renameDataCenterEntry(entryId, name);
      set({ mutating: false });
      await get().load();
    } catch (error) {
      set({ mutating: false });
      throw error;
    }
  },

  deleteEntry: async (entryId) => {
    set({ mutating: true, error: null });
    try {
      await deleteDataCenterEntry(entryId);
      set({ mutating: false });
      await get().load();
      await get().refreshQuota();
    } catch (error) {
      set({ mutating: false });
      throw error;
    }
  },
}));
