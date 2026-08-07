import { create } from 'zustand';
import {
  discoverSaiInterfaces,
  fetchSaiInterfaceCatalogAll,
  SAI_INTERFACE_LIST_PAGE_SIZE,
  type SaiInterfaceCatalogItem,
} from '@/lib/sai-interface-catalog';

interface AppDevInterfaceCatalogState {
  /** 全量 list（一次拉取） */
  listItems: SaiInterfaceCatalogItem[];
  /** 当前搜索词的 discover 结果（置顶补充） */
  discoverItems: SaiInterfaceCatalogItem[];
  /** 前端已展示条数（基于过滤后的全量结果切片） */
  visibleCount: number;
  loading: boolean;
  discovering: boolean;
  error: string | null;
  discoverError: string | null;
  /** 重置并拉全量 list */
  reload: () => Promise<void>;
  /** 前端再展开一页 */
  loadMore: (matchedTotal: number) => void;
  /** 搜索词变化时重置可见窗口 */
  resetVisibleWindow: () => void;
  /** 有关键词时调用 discover；空词清空 discover */
  discover: (query: string) => Promise<void>;
  clear: () => void;
}

let listSeq = 0;
let discoverSeq = 0;

export const useAppDevInterfaceCatalogStore = create<AppDevInterfaceCatalogState>((set) => ({
  listItems: [],
  discoverItems: [],
  visibleCount: SAI_INTERFACE_LIST_PAGE_SIZE,
  loading: false,
  discovering: false,
  error: null,
  discoverError: null,

  clear: () => {
    listSeq += 1;
    discoverSeq += 1;
    set({
      listItems: [],
      discoverItems: [],
      visibleCount: SAI_INTERFACE_LIST_PAGE_SIZE,
      loading: false,
      discovering: false,
      error: null,
      discoverError: null,
    });
  },

  resetVisibleWindow: () => {
    set({ visibleCount: SAI_INTERFACE_LIST_PAGE_SIZE });
  },

  reload: async () => {
    const seq = ++listSeq;
    set({
      loading: true,
      error: null,
      listItems: [],
      visibleCount: SAI_INTERFACE_LIST_PAGE_SIZE,
    });
    try {
      const items = await fetchSaiInterfaceCatalogAll();
      if (seq !== listSeq) return;
      set({
        listItems: items,
        visibleCount: SAI_INTERFACE_LIST_PAGE_SIZE,
        loading: false,
        error: null,
      });
    } catch (err) {
      if (seq !== listSeq) return;
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
        listItems: [],
        visibleCount: SAI_INTERFACE_LIST_PAGE_SIZE,
      });
    }
  },

  loadMore: (matchedTotal) => {
    const total = Math.max(0, Math.floor(matchedTotal));
    set((state) => {
      if (state.loading || state.visibleCount >= total) return state;
      return {
        visibleCount: Math.min(total, state.visibleCount + SAI_INTERFACE_LIST_PAGE_SIZE),
      };
    });
  },

  discover: async (query) => {
    const trimmed = query.trim();
    const seq = ++discoverSeq;
    if (!trimmed) {
      set({ discoverItems: [], discovering: false, discoverError: null });
      return;
    }

    set({ discovering: true, discoverError: null });
    try {
      const items = await discoverSaiInterfaces(trimmed);
      if (seq !== discoverSeq) return;
      set({ discoverItems: items, discovering: false, discoverError: null });
    } catch (err) {
      if (seq !== discoverSeq) return;
      // Keep prior discover hits on failure so results don't flash away.
      set({
        discovering: false,
        discoverError: err instanceof Error ? err.message : String(err),
      });
    }
  },
}));
