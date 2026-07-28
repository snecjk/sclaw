import { create } from 'zustand';
import {
  createDataCenterFolder,
  deleteDataCenterEntry,
  getDataCenterQuota,
  getDataCenterSpaces,
  listDataCenterEntries,
  renameDataCenterEntry,
} from '@/lib/data-center-api';
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
  pageNo: number;
  pageSize: number;
  keyword: string;
  sortField: DataCenterSortField;
  sortOrder: DataCenterSortOrder;
  viewMode: DataCenterViewMode;
  quota: DataCenterQuota | null;
  loading: boolean;
  mutating: boolean;
  error: string | null;
  setSection: (section: DataCenterSection) => void;
  setQaArtifactSpace: (spaceType: 'qa_artifact' | 'site_shared_artifact', spaceId?: string | null) => void;
  setViewMode: (viewMode: DataCenterViewMode) => void;
  setKeyword: (keyword: string) => void;
  setSort: (sortField: DataCenterSortField, sortOrder: DataCenterSortOrder) => void;
  load: (options?: { resetPage?: boolean }) => Promise<void>;
  loadSharedSpaces: () => Promise<DataCenterSpace[]>;
  refreshQuota: () => Promise<void>;
  enterFolder: (entry: DataCenterEntry) => Promise<void>;
  openBreadcrumb: (entryId: string) => Promise<void>;
  createFolder: (name: string) => Promise<void>;
  renameEntry: (entryId: string, name: string) => Promise<void>;
  deleteEntry: (entryId: string) => Promise<void>;
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
  pageNo: 1,
  pageSize: 50,
  keyword: '',
  sortField: 'updatedAt',
  sortOrder: 'desc',
  viewMode: 'list',
  quota: null,
  loading: false,
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
      pageNo: 1,
      keyword: '',
      error: null,
    });
  },

  setQaArtifactSpace: (spaceType, spaceId = null) => {
    set({
      section: 'qa_artifact',
      spaceType,
      spaceId: spaceType === 'site_shared_artifact' ? spaceId : null,
      parentEntryId: 'root',
      breadcrumbs: [],
      items: [],
      total: 0,
      pageNo: 1,
      keyword: '',
      error: null,
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
        pageNo: 1,
        breadcrumbs: [],
        loading: false,
        error: null,
      });
      return;
    }
    const pageNo = options?.resetPage ? 1 : state.pageNo;
    set({ loading: true, error: null, pageNo });
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
      set({
        items: result.items,
        total: result.total,
        pageNo: result.pageNo,
        pageSize: result.pageSize,
        breadcrumbs: result.breadcrumbs ?? [],
        loading: false,
      });
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : String(error) });
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
      set({ mutating: false, error: error instanceof Error ? error.message : String(error) });
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
      set({ mutating: false, error: error instanceof Error ? error.message : String(error) });
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
      set({ mutating: false, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },
}));
