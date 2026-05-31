/**
 * Skill Plaza State Store
 * Manages skill marketplace / plaza UI state
 */
import { create } from 'zustand';
import {
  fetchSkillPlazaCategories,
  fetchSkillPlazaList,
  fetchMySkills as fetchMySkillsApi,
  installPlazaSkill,
  uninstallPlazaSkill,
  recordSkillUse,
} from '@/lib/skill-plaza-api';
import type {
  SkillSummary,
  CategoryDef,
  SkillPlazaTab,
  SkillPlazaSort,
  SkillPlazaView,
} from '@/types/skill-plaza';

interface SkillPlazaState {
  // UI state
  activeTab: SkillPlazaTab;
  activeCategory: string;
  searchQuery: string;
  sortMode: SkillPlazaSort;
  viewMode: SkillPlazaView;

  // Data
  plazaSkills: SkillSummary[];
  mySkills: SkillSummary[];
  categories: CategoryDef[];
  categoryCounts: Record<string, number>;
  skillDetailsCache: Map<string, { skill: SkillSummary; expiresAt: number }>;

  // Pagination
  hasMore: boolean;
  page: number;
  pageSize: number;
  total?: number;

  // Loading states
  loading: boolean;
  installing: Record<string, boolean>;
  uninstalling: Record<string, boolean>;
  error: string | null;

  // Stale flags (trigger re-fetch on tab switch after mutations)
  plazaStale: boolean;
  mineStale: boolean;

  // Actions
  setActiveTab: (tab: SkillPlazaTab) => void;
  setActiveCategory: (category: string) => void;
  setSearchQuery: (query: string) => void;
  setSortMode: (sort: SkillPlazaSort) => void;
  setViewMode: (view: SkillPlazaView) => void;
  setPage: (page: number) => void;

  fetchCategories: () => Promise<void>;
  fetchPlazaSkills: (opts?: { reset?: boolean; skipCategoryCounts?: boolean }) => Promise<void>;
  fetchMySkills: (opts?: { reset?: boolean; skipCategoryCounts?: boolean }) => Promise<void>;

  installSkill: (slug: string) => Promise<void>;
  uninstallSkill: (slug: string) => Promise<void>;
  useSkill: (slug: string) => Promise<void>;

  getCachedSkillDetail: (slug: string) => SkillSummary | undefined;
  setSkillDetailCache: (slug: string, skill: SkillSummary) => void;
  clearSkillDetailCache: () => void;
}

const DETAIL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export const useSkillPlazaStore = create<SkillPlazaState>((set, get) => ({
  // UI state
  activeTab: 'all',
  activeCategory: '',
  searchQuery: '',
  sortMode: 'hot',
  viewMode: 'grid',

  // Data
  plazaSkills: [],
  mySkills: [],
  categories: [],
  categoryCounts: {},
  skillDetailsCache: new Map(),

  // Pagination
  hasMore: false,
  page: 1,
  pageSize: 20,
  total: undefined,

  // Loading
  loading: false,
  installing: {},
  uninstalling: {},
  error: null,

  // Stale flags
  plazaStale: false,
  mineStale: false,

  // -- Setters --
  setActiveTab: (tab) => {
    set({ activeTab: tab, page: 1 });
    if (tab === 'all' && get().plazaStale) {
      get().fetchPlazaSkills({ reset: true });
    } else if (tab === 'mine' && get().mineStale) {
      get().fetchMySkills();
    }
  },
  setActiveCategory: (category) => {
    set({ activeCategory: category, page: 1 });
    if (get().activeTab === 'all') {
      get().fetchPlazaSkills({ reset: true, skipCategoryCounts: true });
    } else {
      get().fetchMySkills({ reset: true, skipCategoryCounts: true });
    }
  },
  setSearchQuery: (query) => {
    set({ searchQuery: query, page: 1 });
    if (get().activeTab === 'all') {
      get().fetchPlazaSkills({ reset: true });
    } else {
      get().fetchMySkills({ reset: true });
    }
  },
  setSortMode: (sort) => {
    set({ sortMode: sort, page: 1 });
    get().fetchPlazaSkills({ reset: true });
  },
  setViewMode: (view) => set({ viewMode: view }),
  setPage: (page) => {
    set({ page });
    get().fetchPlazaSkills();
  },

  // -- Data fetching --
  fetchCategories: async () => {
    try {
      const categories = await fetchSkillPlazaCategories();
      set({ categories });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  fetchPlazaSkills: async (opts) => {
    const { reset, skipCategoryCounts } = opts || {};
    const page = reset ? 1 : get().page;
    if (reset) set({ page: 1 });

    set({ loading: true, error: null });
    try {
      const result = await fetchSkillPlazaList({
        q: get().searchQuery || undefined,
        category: get().activeCategory || undefined,
        sort: get().sortMode,
        page,
        pageSize: get().pageSize,
      });
      const nextState: Partial<SkillPlazaState> = {
        plazaSkills: result.skills,
        hasMore: result.hasMore,
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        loading: false,
        plazaStale: false,
      };
      if (!skipCategoryCounts) {
        nextState.categoryCounts = result.categoryCounts;
      }
      set(nextState);
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  fetchMySkills: async (opts?: { reset?: boolean; skipCategoryCounts?: boolean }) => {
    const { skipCategoryCounts } = opts || {};

    set({ loading: true, error: null });
    try {
      const result = await fetchMySkillsApi();
      const nextState: Partial<SkillPlazaState> = {
        mySkills: result.skills,
        hasMore: false,
        page: 1,
        pageSize: result.skills.length || 20,
        total: result.skills.length,
        loading: false,
        mineStale: false,
      };
      if (!skipCategoryCounts) {
        nextState.categoryCounts = result.categoryCounts;
      }
      set(nextState);
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  // -- Mutations --
  installSkill: async (slug) => {
    set((state) => ({ installing: { ...state.installing, [slug]: true } }));
    try {
      await installPlazaSkill(slug);
      set({ plazaStale: true, mineStale: true });
    } finally {
      set((state) => {
        const next = { ...state.installing };
        delete next[slug];
        return { installing: next };
      });
    }
  },

  uninstallSkill: async (slug) => {
    set((state) => ({ uninstalling: { ...state.uninstalling, [slug]: true } }));
    try {
      await uninstallPlazaSkill(slug);
      set({ plazaStale: true, mineStale: true });
      // Immediately refresh my skills list
      await get().fetchMySkills();
    } finally {
      set((state) => {
        const next = { ...state.uninstalling };
        delete next[slug];
        return { uninstalling: next };
      });
    }
  },

  useSkill: async (slug) => {
    await recordSkillUse(slug);
  },

  // -- Cache --
  getCachedSkillDetail: (slug) => {
    const cached = get().skillDetailsCache.get(slug);
    if (!cached) return undefined;
    if (Date.now() > cached.expiresAt) {
      get().skillDetailsCache.delete(slug);
      return undefined;
    }
    return cached.skill;
  },
  setSkillDetailCache: (slug, skill) => {
    set((state) => {
      const next = new Map(state.skillDetailsCache);
      next.set(slug, { skill, expiresAt: Date.now() + DETAIL_CACHE_TTL_MS });
      return { skillDetailsCache: next };
    });
  },
  clearSkillDetailCache: () => {
    set({ skillDetailsCache: new Map() });
  },
}));
