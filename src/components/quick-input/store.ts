/**
 * 快捷输入列表的共享状态：Picker / Manage / 消息行「存为快捷输入」共用。
 * Manage 弹窗内的拖拽草稿序不进 store，点保存后再 reorder 写回。
 */
import { create } from 'zustand';
import {
  createQuickInput,
  deleteQuickInput,
  listQuickInputs,
  reorderQuickInputs,
  updateQuickInput,
} from '@/lib/quick-input-api';
import {
  QUICK_INPUT_LIST_CAP,
  type QuickInputItem,
  type QuickInputPresence,
} from './types';

/** 合并并发拉取，避免重复请求 */
let fetchInFlight: Promise<void> | null = null;

interface QuickInputState {
  items: QuickInputItem[];
  total: number;
  loading: boolean;
  loaded: boolean;

  /** 从服务端拉取列表并写入缓存 */
  fetchList: () => Promise<void>;
  /** 尚未加载时拉取一次；已加载则直接返回 */
  ensureLoaded: () => Promise<void>;
  /** 新建一条并插入缓存头部 */
  create: (content: string) => Promise<QuickInputItem>;
  /** 更新指定项内容并同步缓存 */
  update: (id: string, content: string) => Promise<QuickInputItem>;
  /** 删除指定项并同步缓存 */
  remove: (id: string) => Promise<void>;
  /** 按 id 顺序重排并写回缓存 */
  reorder: (orderedIds: string[]) => Promise<QuickInputItem[]>;
  /** 仅读缓存判断内容是否已存在，不请求列表 API */
  getPresence: (content: string) => QuickInputPresence;
}

export const useQuickInputStore = create<QuickInputState>((set, get) => ({
  items: [],
  total: 0,
  loading: false,
  loaded: false,

  /** 从服务端拉取列表并写入缓存 */
  fetchList: async () => {
    if (fetchInFlight) return fetchInFlight;

    fetchInFlight = (async () => {
      set({ loading: true });
      try {
        const result = await listQuickInputs();
        set({
          items: result.items.slice(0, QUICK_INPUT_LIST_CAP),
          total: result.total,
          loading: false,
          loaded: true,
        });
      } catch (err) {
        set({ items: [], total: 0, loading: false, loaded: false });
        throw err;
      } finally {
        fetchInFlight = null;
      }
    })();

    return fetchInFlight;
  },

  /** 尚未加载时拉取一次；已加载则直接返回 */
  ensureLoaded: async () => {
    if (get().loaded) return;
    await get().fetchList();
  },

  /** 新建一条并插入缓存头部 */
  create: async (content) => {
    const item = await createQuickInput(content);
    set((state) => ({
      items: [item, ...state.items].slice(0, QUICK_INPUT_LIST_CAP),
      total: state.total + 1,
      loaded: true,
    }));
    return item;
  },

  /** 更新指定项内容并同步缓存 */
  update: async (id, content) => {
    const item = await updateQuickInput(id, content);
    set((state) => ({
      items: state.items.map((entry) => (entry.id === item.id ? item : entry)),
    }));
    return item;
  },

  /** 删除指定项并同步缓存 */
  remove: async (id) => {
    await deleteQuickInput(id);
    set((state) => ({
      items: state.items.filter((entry) => entry.id !== id),
      total: Math.max(0, state.total - 1),
    }));
  },

  /** 按 id 顺序重排并写回缓存 */
  reorder: async (orderedIds) => {
    const next = await reorderQuickInputs(orderedIds);
    const capped = next.slice(0, QUICK_INPUT_LIST_CAP);
    set({ items: capped, total: next.length, loaded: true });
    return capped;
  },

  /** 仅读缓存判断内容是否已存在，不请求列表 API */
  getPresence: (content) => {
    const trimmed = content.trim();
    if (!trimmed) return 'empty';

    return get().items.some((item) => item.content.trim() === trimmed)
      ? 'exists'
      : 'absent';
  },
}));
