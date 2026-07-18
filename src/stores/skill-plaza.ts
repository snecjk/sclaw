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
  uploadSkillZip,
  isSkillPlazaAuthNotReadyError,
  type InstallPlazaSkillOptions,
} from '@/lib/skill-plaza-api';
import { applyMineCategoryFallback, MINE_FALLBACK_CATEGORY_CODE } from '@/lib/skill-plaza-category';
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
  // True while refreshing in the background with data already on screen
  // (stale-while-revalidate). Never blocks the list.
  backgroundRefreshing: boolean;
  // True while the STO token is not ready yet: the page shows a loading state
  // and the store retries until auth becomes available.
  awaitingAuth: boolean;
  installing: Record<string, boolean>;
  uninstalling: Record<string, boolean>;
  uploading: boolean;
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
  uploadSkill: (filePath: string) => Promise<string>;
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

// ---------------------------------------------------------------------------
// Request coordination (module scope; intentionally outside React state)
// ---------------------------------------------------------------------------

// Collapse concurrent identical requests so overlapping effects / strict-mode
// double mounts do not fan out into duplicate network round-trips.
const inflightRequests = new Map<string, Promise<void>>();

function dedupeRequest(key: string, run: () => Promise<void>): Promise<void> {
  const existing = inflightRequests.get(key);
  if (existing) return existing;
  const promise = run().finally(() => {
    if (inflightRequests.get(key) === promise) {
      inflightRequests.delete(key);
    }
  });
  inflightRequests.set(key, promise);
  return promise;
}

// Monotonic sequence numbers guard against out-of-order responses overwriting
// a newer query's result (e.g. fast typing in search).
let plazaRequestSeq = 0;
let mineRequestSeq = 0;

// When a fetch reports the STO token is not ready yet, we keep the UI in a
// loading state and retry with a bounded backoff until the token arrives.
let authRetryTimer: ReturnType<typeof setTimeout> | null = null;
let authRetryAttempts = 0;
const AUTH_RETRY_MAX_ATTEMPTS = 30;
const AUTH_RETRY_DELAY_MS = 800;

function resetAuthRetry(): void {
  if (authRetryTimer) {
    clearTimeout(authRetryTimer);
    authRetryTimer = null;
  }
  authRetryAttempts = 0;
}

function scheduleAuthRetry(retry: () => void): void {
  if (authRetryTimer) return; // a retry is already pending
  if (authRetryAttempts >= AUTH_RETRY_MAX_ATTEMPTS) return; // give up after ~24s
  authRetryTimer = setTimeout(() => {
    authRetryTimer = null;
    authRetryAttempts += 1;
    retry();
  }, AUTH_RETRY_DELAY_MS);
}

// Re-run the fetches the current view needs. Referenced lazily so it can use
// the store instance defined below.
function triggerAuthRetry(): void {
  const state = useSkillPlazaStore.getState();
  void state.fetchCategories();
  void state.fetchPlazaSkills({ reset: true });
  if (state.activeTab === 'mine') {
    void state.fetchLocalSkills();
  }
}

function plazaRequestKey(state: {
  searchQuery: string;
  activeCategory: string;
  sortMode: SkillPlazaSort;
  page: number;
  pageSize: number;
}): string {
  return [
    'plaza',
    state.searchQuery,
    state.activeCategory,
    state.sortMode,
    state.page,
    state.pageSize,
  ].join('|');
}

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
  backgroundRefreshing: false,
  awaitingAuth: false,
  installing: {},
  uninstalling: {},
  uploading: false,
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
    // Plaza tab filters server-side; "mine" tab filters the already-loaded
    // list client-side (SkillPlazaPage), so no refetch is needed there.
    if (get().activeTab === 'all') {
      get().fetchPlazaSkills({ reset: true });
    }
  },
  setSearchQuery: (query) => {
    set({ searchQuery: query, page: 1 });
    // See setActiveCategory: "mine" search is a pure client-side filter.
    if (get().activeTab === 'all') {
      get().fetchPlazaSkills({ reset: true });
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
    return dedupeRequest('categories', async () => {
      try {
        const categories = await fetchSkillPlazaCategories();
        set({ categories });
      } catch (err) {
        if (isSkillPlazaAuthNotReadyError(err)) {
          set({ awaitingAuth: true });
          scheduleAuthRetry(triggerAuthRetry);
          return;
        }
        set({ error: String(err) });
      }
    });
  },

  fetchPlazaSkills: async (opts) => {
    const { reset, skipCategoryCounts } = opts || {};
    const page = reset ? 1 : get().page;
    if (reset) set({ page: 1 });

    const key = plazaRequestKey({
      searchQuery: get().searchQuery,
      activeCategory: get().activeCategory,
      sortMode: get().sortMode,
      page,
      pageSize: get().pageSize,
    });

    return dedupeRequest(key, async () => {
      const seq = ++plazaRequestSeq;
      // Stale-while-revalidate: keep the current list visible and only show the
      // blocking loader when there is nothing to show yet.
      const hasData = get().plazaSkills.length > 0;
      set(hasData
        ? { backgroundRefreshing: true, error: null }
        : { loading: true, error: null });

      try {
        const result = await fetchSkillPlazaList({
          q: get().searchQuery || undefined,
          category: get().activeCategory || undefined,
          sort: get().sortMode,
          page,
          pageSize: get().pageSize,
        });
        // Drop out-of-order responses so a slow earlier query cannot overwrite
        // a newer one's result.
        if (seq !== plazaRequestSeq) return;

        const metaMap = { ...get().plazaSkillMetaMap };
        for (const skill of result.skills) {
          metaMap[skill.slug] = {
            title: skill.title,
            description: skill.description,
            category: skill.category,
            categoryCode: skill.categoryCode,
            categoryCodes: skill.categoryCodes,
            categoryNames: skill.categoryNames,
            installCount: skill.installCount,
            useCount: skill.useCount,
          };
        }
        savePlazaMetaCache(metaMap);

        // A successful list load means auth is ready; stop any retry loop.
        resetAuthRetry();
        const nextState: Partial<SkillPlazaState> = {
          plazaSkills: result.skills,
          hasMore: result.hasMore,
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          loading: false,
          backgroundRefreshing: false,
          awaitingAuth: false,
          plazaStale: false,
          plazaSkillMetaMap: metaMap,
        };
        if (!skipCategoryCounts && get().activeTab === 'all') {
          nextState.categoryCounts = result.categoryCounts;
        }
        set(nextState);
      } catch (err) {
        if (seq !== plazaRequestSeq) return;
        if (isSkillPlazaAuthNotReadyError(err)) {
          // Token not ready yet: keep the loading state (no error toast) and
          // retry until it arrives.
          set({
            awaitingAuth: true,
            loading: get().plazaSkills.length === 0,
            backgroundRefreshing: false,
          });
          scheduleAuthRetry(triggerAuthRetry);
          return;
        }
        // On a background refresh failure keep the stale data on screen.
        set({ error: String(err), loading: false, backgroundRefreshing: false });
      }
    });
  },

  fetchLocalSkills: async (opts?: { reset?: boolean; skipCategoryCounts?: boolean }) => {
    const { skipCategoryCounts } = opts || {};

    return dedupeRequest('local-skills', async () => {
    const seq = ++mineRequestSeq;
    const hasData = get().mySkills.length > 0;
    set(hasData
      ? { backgroundRefreshing: true, error: null }
      : { loading: true, error: null });
    try {
      const result = await fetchLocalSkills();
      if (seq !== mineRequestSeq) return;
      // Enrich mySkills from plaza list / cache so display matches the plaza tab
      const { plazaSkillMetaMap, categories, plazaSkills } = get();
      const enrichedSkills = result.skills.map((skill) => {
        const plazaSkill = plazaSkills.find((s) => s.slug === skill.slug);
        const meta = plazaSkillMetaMap[skill.slug];

        let merged: SkillSummary = { ...skill };

        if (plazaSkill || meta) {
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
          if (plazaSkill?.updateAvailable != null) {
            merged.updateAvailable = plazaSkill.updateAvailable;
          }
        }

        return applyMineCategoryFallback(merged, categories, plazaSkillMetaMap, plazaSkill);
      });

      resetAuthRetry();
      const nextState: Partial<SkillPlazaState> = {
        mySkills: enrichedSkills,
        hasMore: false,
        page: 1,
        pageSize: result.skills.length || 20,
        total: result.skills.length,
        loading: false,
        backgroundRefreshing: false,
        awaitingAuth: false,
        mineStale: false,
      };
      if (!skipCategoryCounts && get().activeTab === 'mine') {
        nextState.categoryCounts = result.categoryCounts;
      }
      set(nextState);
    } catch (err) {
      if (seq !== mineRequestSeq) return;
      if (isSkillPlazaAuthNotReadyError(err)) {
        set({
          awaitingAuth: true,
          loading: get().mySkills.length === 0,
          backgroundRefreshing: false,
        });
        scheduleAuthRetry(triggerAuthRetry);
        return;
      }
      set({ error: String(err), loading: false, backgroundRefreshing: false });
    }
    });
  },

  syncUserSkills: async () => {
    // Only refresh public plaza data on user change. "我的技能" loads lazily
    // when its tab is opened, keeping the heavy local-skills scan off the
    // first-paint critical path.
    set({ syncingUserSkills: true, error: null });
    try {
      await get().fetchCategories();
      await get().fetchPlazaSkills({ reset: true });
      // Local skills are stale after an account switch; refresh them only when
      // the user is already viewing the "mine" tab.
      if (get().activeTab === 'mine') {
        await get().fetchLocalSkills();
      } else {
        set({ mineStale: true });
      }
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

  uploadSkill: async (filePath) => {
    set({ uploading: true });
    try {
      const slug = await uploadSkillZip(filePath);
      set({
        activeTab: 'mine',
        activeCategory: MINE_FALLBACK_CATEGORY_CODE,
        searchQuery: '',
        page: 1,
        plazaStale: true,
        mineStale: true,
      });
      // Refresh local skills so the newly uploaded skill appears in the list
      await get().fetchLocalSkills();
      return slug;
    } finally {
      set({ uploading: false });
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
