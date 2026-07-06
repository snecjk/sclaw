/**
 * Skill Plaza State Store
 * Manages skill marketplace / plaza UI state
 */
import { create } from 'zustand';
import {
  fetchSkillPlazaCategories,
  fetchSkillPlazaList,
  fetchLocalSkills,
  installPlazaSkill,
  uninstallPlazaSkill,
  recordSkillUse,
  toggleSkillEnabled,
  type InstallPlazaSkillOptions,
} from '@/lib/skill-plaza-api';
import type {
  SkillSummary,
  CategoryDef,
  SkillPlazaTab,
  SkillPlazaSort,
  SkillPlazaView,
  PlazaSkillMeta,
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
  plazaSkillMetaMap: Record<string, PlazaSkillMeta>;

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
  syncingUserSkills: boolean;

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
  fetchLocalSkills: (opts?: { reset?: boolean; skipCategoryCounts?: boolean }) => Promise<void>;
  syncUserSkills: () => Promise<void>;

  installSkill: (slug: string, options?: InstallPlazaSkillOptions) => Promise<void>;
  uninstallSkill: (slug: string) => Promise<void>;
  useSkill: (slug: string) => Promise<void>;
  toggleSkill: (slug: string, enabled: boolean) => Promise<void>;

  getCachedSkillDetail: (slug: string) => SkillSummary | undefined;
  setSkillDetailCache: (slug: string, skill: SkillSummary) => void;
  clearSkillDetailCache: () => void;
}

// Load plaza meta cache from localStorage on init
function loadPlazaMetaCache(): Record<string, PlazaSkillMeta> {
  try {
    const raw = localStorage.getItem('skill-plaza-meta-cache');
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore parse errors
  }
  return {};
}

// Persist plaza meta cache to localStorage
function savePlazaMetaCache(map: Record<string, PlazaSkillMeta>) {
  try {
    localStorage.setItem('skill-plaza-meta-cache', JSON.stringify(map));
  } catch {
    // ignore storage errors
  }
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
  plazaSkillMetaMap: loadPlazaMetaCache(),

  // Pagination
  hasMore: false,
  page: 1,
  pageSize: 50,
  total: undefined,

  // Loading
  loading: false,
  installing: {},
  uninstalling: {},
  error: null,
  syncingUserSkills: false,

  // Stale flags
  plazaStale: false,
  mineStale: false,

  // -- Setters --
  setActiveTab: (tab) => {
    set({ activeTab: tab, page: 1, activeCategory: '' });
    if (tab === 'all') {
      get().fetchPlazaSkills({ reset: true });
    } else if (tab === 'mine') {
      if (get().plazaSkills.length === 0) {
        void get().fetchPlazaSkills({ reset: true }).then(() => get().fetchLocalSkills({ reset: true }));
      } else {
        get().fetchLocalSkills({ reset: true });
      }
    }
  },
  setActiveCategory: (category) => {
    set({ activeCategory: category, page: 1 });
    if (get().activeTab === 'all') {
      get().fetchPlazaSkills({ reset: true });
    } else {
      get().fetchLocalSkills({ reset: true });
    }
  },
  setSearchQuery: (query) => {
    set({ searchQuery: query, page: 1 });
    if (get().activeTab === 'all') {
      get().fetchPlazaSkills({ reset: true });
    } else {
      get().fetchLocalSkills({ reset: true });
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
      const metaMap = { ...get().plazaSkillMetaMap };
      for (const skill of result.skills) {
        metaMap[skill.slug] = {
          title: skill.title,
          description: skill.description,
          category: skill.category,
          categoryCode: skill.categoryCode,
          installCount: skill.installCount,
          useCount: skill.useCount,
        };
      }
      savePlazaMetaCache(metaMap);

      const nextState: Partial<SkillPlazaState> = {
        plazaSkills: result.skills,
        hasMore: result.hasMore,
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        loading: false,
        plazaStale: false,
        plazaSkillMetaMap: metaMap,
      };
      if (!skipCategoryCounts && get().activeTab === 'all') {
        nextState.categoryCounts = result.categoryCounts;
      }
      set(nextState);
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  fetchLocalSkills: async (opts?: { reset?: boolean; skipCategoryCounts?: boolean }) => {
    const { skipCategoryCounts } = opts || {};

    set({ loading: true, error: null });
    try {
      const result = await fetchLocalSkills();
      // Enrich mySkills from plaza list / cache so display matches the plaza tab
      const { plazaSkillMetaMap, categories, plazaSkills } = get();
      const enrichedSkills = result.skills.map((skill) => {
        const plazaSkill = plazaSkills.find((s) => s.slug === skill.slug);
        const meta = plazaSkillMetaMap[skill.slug];
        if (!plazaSkill && !meta) return skill;

        let code = skill.categoryCode || plazaSkill?.categoryCode || meta?.categoryCode || null;
        if (!code && (plazaSkill?.category || meta?.category)) {
          const label = plazaSkill?.category || meta?.category;
          const cat = categories.find((c) => c.label === label);
          if (cat) code = cat.slug;
        }

        const merged: SkillSummary = { ...skill };

        // title/description: plaza list > meta cache > local (from API)
        if (plazaSkill?.title) {
          merged.title = plazaSkill.title;
        } else if (meta?.title) {
          merged.title = meta.title;
        }
        if (plazaSkill?.description) {
          merged.description = plazaSkill.description;
        } else if (meta?.description) {
          merged.description = meta.description;
        }

        if (code) {
          merged.category = plazaSkill?.category || meta?.category || skill.category;
          merged.categoryCode = code;
        }
        if (plazaSkill?.installCount != null) {
          merged.installCount = plazaSkill.installCount;
        } else if (meta?.installCount != null) {
          merged.installCount = meta.installCount;
        }
        if (plazaSkill?.useCount != null) {
          merged.useCount = plazaSkill.useCount;
        } else if (meta?.useCount != null) {
          merged.useCount = meta.useCount;
        }

        // Return original object if nothing changed
        if (
          merged.title === skill.title &&
          merged.description === skill.description &&
          merged.category === skill.category &&
          merged.categoryCode === skill.categoryCode &&
          merged.installCount === skill.installCount &&
          merged.useCount === skill.useCount
        ) {
          return skill;
        }
        return merged;
      });

      const nextState: Partial<SkillPlazaState> = {
        mySkills: enrichedSkills,
        hasMore: false,
        page: 1,
        pageSize: result.skills.length || 20,
        total: result.skills.length,
        loading: false,
        mineStale: false,
      };
      if (!skipCategoryCounts && get().activeTab === 'mine') {
        nextState.categoryCounts = result.categoryCounts;
      }
      set(nextState);
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  syncUserSkills: async () => {
    set({ syncingUserSkills: true, error: null });
    try {
      await get().fetchCategories();
      // Plaza list must load before local skills so title/description enrichment can apply
      await get().fetchPlazaSkills({ reset: true });
      await get().fetchLocalSkills();
    } catch (err) {
      console.error('Failed to sync user skills:', err);
      set({ error: String(err) });
    } finally {
      set({ syncingUserSkills: false });
    }
  },

  // -- Mutations --
  installSkill: async (slug, options) => {
    set((state) => ({ installing: { ...state.installing, [slug]: true } }));
    try {
      await installPlazaSkill(slug, options);
      set({ plazaStale: true, mineStale: true });
      // Optimistic update: increment installCount locally
      set((state) => {
        const nextMetaMap = { ...state.plazaSkillMetaMap };
        if (nextMetaMap[slug]) {
          nextMetaMap[slug] = {
            ...nextMetaMap[slug],
            installCount: (nextMetaMap[slug].installCount || 0) + 1,
          };
        }
        savePlazaMetaCache(nextMetaMap);
        return {
          plazaSkillMetaMap: nextMetaMap,
          plazaSkills: state.plazaSkills.map((s) =>
            s.slug === slug
              ? { ...s, installed: true, installCount: (s.installCount || 0) + 1 }
              : s
          ),
          mySkills: state.mySkills.map((s) =>
            s.slug === slug
              ? { ...s, installed: true, installCount: (s.installCount || 0) + 1 }
              : s
          ),
        };
      });
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
      await get().fetchLocalSkills();
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
    // Optimistic update: increment useCount locally
    set((state) => {
      const nextMetaMap = { ...state.plazaSkillMetaMap };
      if (nextMetaMap[slug]) {
        nextMetaMap[slug] = {
          ...nextMetaMap[slug],
          useCount: (nextMetaMap[slug].useCount || 0) + 1,
        };
      }
      savePlazaMetaCache(nextMetaMap);
      return {
        plazaSkillMetaMap: nextMetaMap,
        plazaSkills: state.plazaSkills.map((s) =>
          s.slug === slug ? { ...s, useCount: (s.useCount || 0) + 1 } : s
        ),
        mySkills: state.mySkills.map((s) =>
          s.slug === slug ? { ...s, useCount: (s.useCount || 0) + 1 } : s
        ),
      };
    });
  },

  toggleSkill: async (slug, enabled) => {
    try {
      await toggleSkillEnabled(slug, enabled);
      set((state) => ({
        mySkills: state.mySkills.map((s) =>
          s.slug === slug ? { ...s, enabled } : s
        ),
      }));
    } catch (err) {
      set({ error: String(err) });
    }
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
