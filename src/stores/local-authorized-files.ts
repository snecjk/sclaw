import { create } from 'zustand';
import {
  authorizeLocalFiles,
  listLocalAuthorizedFiles,
  removeLocalAuthorizedEntry,
  renameLocalAuthorizedEntry,
} from '@/lib/local-authorized-files-api';
import type {
  LocalAuthorizedFileBreadcrumb,
  LocalAuthorizedFileEntry,
  LocalAuthorizedFileStats,
} from '@/types/local-authorized-file';
import type { DataCenterViewMode } from '@/types/data-center';

interface LocalAuthorizedFilesStoreState {
  parentEntryId: string;
  breadcrumbs: LocalAuthorizedFileBreadcrumb[];
  items: LocalAuthorizedFileEntry[];
  total: number;
  keyword: string;
  viewMode: DataCenterViewMode;
  stats: LocalAuthorizedFileStats;
  loading: boolean;
  mutating: boolean;
  error: string | null;
  setViewMode: (viewMode: DataCenterViewMode) => void;
  setKeyword: (keyword: string) => void;
  load: (options?: { resetRoot?: boolean }) => Promise<void>;
  authorize: () => Promise<boolean>;
  enterFolder: (entry: LocalAuthorizedFileEntry) => Promise<void>;
  openBreadcrumb: (entryId: string) => Promise<void>;
  renameEntry: (entryId: string, name: string) => Promise<void>;
  deleteEntry: (entryId: string) => Promise<void>;
}

const emptyStats: LocalAuthorizedFileStats = {
  authorizedCount: 0,
  folderCount: 0,
  uncategorizedFileCount: 0,
};

export const useLocalAuthorizedFilesStore = create<LocalAuthorizedFilesStoreState>((set, get) => ({
  parentEntryId: 'root',
  breadcrumbs: [],
  items: [],
  total: 0,
  keyword: '',
  viewMode: 'list',
  stats: emptyStats,
  loading: false,
  mutating: false,
  error: null,

  setViewMode: (viewMode) => set({ viewMode }),
  setKeyword: (keyword) => set({ keyword }),

  load: async (options) => {
    const parentEntryId = options?.resetRoot ? 'root' : get().parentEntryId;
    if (options?.resetRoot) {
      set({ parentEntryId, breadcrumbs: [] });
    }
    set({ loading: true, error: null });
    try {
      const result = await listLocalAuthorizedFiles({
        parentEntryId,
        keyword: get().keyword,
      });
      set({
        items: result.items,
        total: result.total,
        breadcrumbs: result.breadcrumbs,
        stats: result.stats,
        loading: false,
      });
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  authorize: async () => {
    set({ mutating: true, error: null });
    try {
      const result = await authorizeLocalFiles();
      if (result.canceled) {
        set({ mutating: false });
        return false;
      }
      set({
        mutating: false,
        parentEntryId: 'root',
        breadcrumbs: [],
        items: result.items,
        total: result.total,
        stats: result.stats,
      });
      return true;
    } catch (error) {
      set({ mutating: false, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },

  enterFolder: async (entry) => {
    if (entry.entryType !== 'folder') return;
    set({ parentEntryId: entry.entryId, keyword: '' });
    await get().load();
  },

  openBreadcrumb: async (entryId) => {
    set({ parentEntryId: entryId || 'root', keyword: '' });
    await get().load();
  },

  renameEntry: async (entryId, name) => {
    set({ mutating: true, error: null });
    try {
      await renameLocalAuthorizedEntry(entryId, name);
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
      const target = get().items.find((item) => item.entryId === entryId);
      const result = await removeLocalAuthorizedEntry(entryId);
      if (!target || target.parentEntryId === 'root') {
        set({
          mutating: false,
          parentEntryId: 'root',
          breadcrumbs: [],
          items: result.items,
          total: result.total,
          stats: result.stats,
        });
        return;
      }
      set({ mutating: false });
      await get().load();
    } catch (error) {
      set({ mutating: false, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },
}));
