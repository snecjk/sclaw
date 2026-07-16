/**
 * More Apps Store — manages 应用广场 UI state and localStorage persistence
 * Aligned with the PRD demo (more-apps.js)
 *
 * Market tab (Banner / 分类 / APP) is driven by server catalog state fetched via the
 * Main Host API proxy. The three blocks keep independent loading/error so one failure
 * does not break the others; APP supports reset, append pagination and request-race
 * protection. "我的应用"、收藏和外部应用 remain per-user localStorage-backed.
 */
import { create } from 'zustand';
import type {
  AppItem,
  AppPlazaBanner,
  AppPlazaCategory,
  MarketCategory,
  MoreAppsSortMode,
  MoreAppsTab,
} from '@/types/more-apps';
import { VISIBLE_BUILTIN_APPS } from '@/components/more-apps/builtin-apps';
import {
  fetchAppPlazaApps,
  fetchAppPlazaBanners,
  fetchAppPlazaCategories,
} from '@/lib/app-plaza-api';

const STORAGE_KEY_EXTERNAL = 'stoclaw:more-apps:external';
const STORAGE_KEY_INSTALLED = 'stoclaw:more-apps:installed';
const STORAGE_KEY_FAVORITES = 'stoclaw:more-apps:favorites';

const APP_PAGE_SIZE = 20;

// Per-user storage key — falls back to the legacy global key when no user is signed
// in, so external apps / favorites keep working across the migration to per-user scope.
function storageKey(base: string, userCode: string): string {
  return userCode ? `${base}:${userCode}` : base;
}

// Request-sequence guards — a stale slow response is discarded when a newer
// reset/append has started, so the UI never shows out-of-order catalog results.
let appsRequestSeq = 0;
let bannersRequestSeq = 0;
let categoriesRequestSeq = 0;

function toError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── localStorage helpers ──────────────────────────────────────────
function loadExternalApps(userCode: string): AppItem[] {
  try {
    const raw = localStorage.getItem(storageKey(STORAGE_KEY_EXTERNAL, userCode));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (a) => a && typeof a.id === 'string' && typeof a.url === 'string',
    );
  } catch {
    return [];
  }
}

function saveExternalApps(apps: AppItem[], userCode: string): void {
  try {
    localStorage.setItem(storageKey(STORAGE_KEY_EXTERNAL, userCode), JSON.stringify(apps));
  } catch {
    // ignore
  }
}

function loadInstalled(userCode: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey(STORAGE_KEY_INSTALLED, userCode));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveInstalled(ids: string[], userCode: string): void {
  try {
    localStorage.setItem(storageKey(STORAGE_KEY_INSTALLED, userCode), JSON.stringify(ids));
  } catch {
    // ignore
  }
}

function loadFavorites(userCode: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey(STORAGE_KEY_FAVORITES, userCode));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveFavorites(ids: string[], userCode: string): void {
  try {
    localStorage.setItem(storageKey(STORAGE_KEY_FAVORITES, userCode), JSON.stringify(ids));
  } catch {
    // ignore
  }
}

// ── Store interface ────────────────────────────────────────────────
interface MoreAppsState {
  // UI state
  activeTab: MoreAppsTab;
  searchQuery: string;
  sortMode: MoreAppsSortMode;
  marketCategory: MarketCategory;
  heroSlideIndex: number;

  // Per-user scope
  userCode: string;

  // Server catalog — Banner block (independent loading/error)
  banners: AppPlazaBanner[];
  bannersLoading: boolean;
  bannersError: string | null;

  // Server catalog — 分类 block (independent loading/error)
  categories: AppPlazaCategory[];
  categoriesLoading: boolean;
  categoriesError: string | null;

  // Server catalog — APP block (independent loading/error, with pagination + race guard)
  apps: AppItem[];
  total: number;
  pageNum: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;

  // Per-user data (localStorage-backed; unchanged behavior)
  builtinApps: AppItem[];
  externalApps: AppItem[];
  installedIds: string[];
  favoriteIds: string[];

  // Modal
  addModalOpen: boolean;
  editingExternalAppId: string | null;

  // Actions — UI
  setActiveTab: (tab: MoreAppsTab) => void;
  setSearchQuery: (q: string) => void;
  setSortMode: (mode: MoreAppsSortMode) => void;
  setMarketCategory: (cat: MarketCategory) => void;
  setHeroSlideIndex: (idx: number) => void;
  openAddModal: () => void;
  openEditModal: (id: string) => void;
  closeAddModal: () => void;

  // Actions — external / installed / favorites (unchanged behavior)
  addExternalApp: (app: { name: string; url: string; description?: string }) => void;
  updateExternalApp: (id: string, app: { name: string; url: string; description?: string }) => void;
  removeExternalApp: (id: string) => void;
  installApp: (id: string) => void;
  uninstallApp: (id: string) => void;
  isAppInstalled: (id: string) => boolean;
  toggleFavorite: (id: string) => void;
  isAppFavorite: (id: string) => boolean;

  // Actions — server catalog
  initialize: (userCode: string) => Promise<void>;
  fetchBanners: () => Promise<void>;
  fetchCategories: () => Promise<void>;
  fetchApps: (opts?: { reset?: boolean }) => Promise<void>;
  loadMoreApps: () => Promise<void>;
}

export const useMoreAppsStore = create<MoreAppsState>((set, get) => ({
  activeTab: 'market',
  searchQuery: '',
  sortMode: 'default',
  marketCategory: 'featured',
  heroSlideIndex: 0,

  userCode: '',

  banners: [],
  bannersLoading: false,
  bannersError: null,

  categories: [],
  categoriesLoading: false,
  categoriesError: null,

  apps: [],
  total: 0,
  pageNum: 0,
  loading: false,
  loadingMore: false,
  error: null,

  builtinApps: VISIBLE_BUILTIN_APPS,
  externalApps: loadExternalApps(''),
  installedIds: loadInstalled(''),
  favoriteIds: loadFavorites(''),

  addModalOpen: false,
  editingExternalAppId: null,

  setActiveTab: (tab) => set({ activeTab: tab, searchQuery: '' }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSortMode: (mode) => set({ sortMode: mode }),
  setMarketCategory: (cat) => set({ marketCategory: cat }),
  setHeroSlideIndex: (idx) => set({ heroSlideIndex: idx }),

  openAddModal: () => set({ addModalOpen: true, editingExternalAppId: null }),
  openEditModal: (id) => set({ addModalOpen: true, editingExternalAppId: id }),
  closeAddModal: () => set({ addModalOpen: false, editingExternalAppId: null }),

  addExternalApp: ({ name, url, description }) => {
    const userCode = get().userCode;
    const id = `ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newApp: AppItem = {
      id,
      name: name.trim(),
      url: url.trim(),
      description: description?.trim() || '外部应用链接',
      iconKey: 'external',
      tone: 'gray',
      category: '外部应用',
      kind: 'external',
      installed: true,
      external: true,
      createdAt: Date.now(),
      order: 999,
    };
    const updated = [...get().externalApps, newApp];
    saveExternalApps(updated, userCode);
    // Also add to installed
    const updatedInstalled = [...get().installedIds, id];
    saveInstalled(updatedInstalled, userCode);
    set({
      externalApps: updated,
      installedIds: updatedInstalled,
      addModalOpen: false,
      editingExternalAppId: null,
    });
  },

  updateExternalApp: (id, { name, url, description }) => {
    const userCode = get().userCode;
    const updated = get().externalApps.map((app) =>
      app.id === id
        ? {
            ...app,
            name: name.trim(),
            url: url.trim(),
            description: description?.trim() || '外部应用链接',
          }
        : app,
    );
    saveExternalApps(updated, userCode);
    set({
      externalApps: updated,
      addModalOpen: false,
      editingExternalAppId: null,
    });
  },

  removeExternalApp: (id) => {
    const userCode = get().userCode;
    const updated = get().externalApps.filter((a) => a.id !== id);
    saveExternalApps(updated, userCode);
    const updatedInstalled = get().installedIds.filter((x) => x !== id);
    saveInstalled(updatedInstalled, userCode);
    const updatedFavorites = get().favoriteIds.filter((x) => x !== id);
    saveFavorites(updatedFavorites, userCode);
    set({
      externalApps: updated,
      installedIds: updatedInstalled,
      favoriteIds: updatedFavorites,
    });
  },

  installApp: (id) => {
    const userCode = get().userCode;
    const installedIds = get().installedIds;
    if (installedIds.indexOf(id) === -1) {
      const updated = [...installedIds, id];
      saveInstalled(updated, userCode);
      set({ installedIds: updated });
    }
  },

  uninstallApp: (id) => {
    const userCode = get().userCode;
    const updated = get().installedIds.filter((x) => x !== id);
    saveInstalled(updated, userCode);
    set({ installedIds: updated });
  },

  isAppInstalled: (id) => {
    return get().installedIds.indexOf(id) !== -1;
  },

  toggleFavorite: (id) => {
    const userCode = get().userCode;
    const favoriteIds = get().favoriteIds;
    if (favoriteIds.indexOf(id) !== -1) {
      const updated = favoriteIds.filter((x) => x !== id);
      saveFavorites(updated, userCode);
      set({ favoriteIds: updated });
    } else {
      const updated = [...favoriteIds, id];
      saveFavorites(updated, userCode);
      set({ favoriteIds: updated });
    }
  },

  isAppFavorite: (id) => {
    return get().favoriteIds.indexOf(id) !== -1;
  },

  initialize: async (userCode) => {
    // Per-user data is loaded synchronously so the installed/favorites views stay
    // responsive; catalog state is reset before the three independent fetches kick off.
    set({
      userCode,
      externalApps: loadExternalApps(userCode),
      installedIds: loadInstalled(userCode),
      favoriteIds: loadFavorites(userCode),
      banners: [],
      bannersLoading: false,
      bannersError: null,
      categories: [],
      categoriesLoading: false,
      categoriesError: null,
      apps: [],
      total: 0,
      pageNum: 0,
      loading: false,
      loadingMore: false,
      error: null,
    });
    await Promise.all([
      get().fetchBanners(),
      get().fetchCategories(),
      get().fetchApps({ reset: true }),
    ]);
  },

  fetchBanners: async () => {
    const seq = ++bannersRequestSeq;
    set({ bannersLoading: true, bannersError: null });
    try {
      const banners = await fetchAppPlazaBanners();
      if (seq !== bannersRequestSeq) return;
      set({ banners, bannersLoading: false, bannersError: null });
    } catch (err) {
      if (seq !== bannersRequestSeq) return;
      set({ bannersError: toError(err), bannersLoading: false });
    }
  },

  fetchCategories: async () => {
    const seq = ++categoriesRequestSeq;
    set({ categoriesLoading: true, categoriesError: null });
    try {
      const categories = await fetchAppPlazaCategories();
      if (seq !== categoriesRequestSeq) return;
      set({ categories, categoriesLoading: false, categoriesError: null });
    } catch (err) {
      if (seq !== categoriesRequestSeq) return;
      set({ categoriesError: toError(err), categoriesLoading: false });
    }
  },

  fetchApps: async (opts) => {
    const reset = opts?.reset ?? false;
    const seq = ++appsRequestSeq;
    const { searchQuery, marketCategory, pageNum: currPage, apps: currApps } = get();
    const nextPage = reset ? 1 : currPage + 1;
    if (reset) {
      set({ loading: true, error: null, pageNum: 1, apps: [] });
    } else {
      set({ loadingMore: true });
    }
    try {
      const result = await fetchAppPlazaApps({
        pageNum: nextPage,
        pageSize: APP_PAGE_SIZE,
        keyword: searchQuery.trim() || undefined,
        categoryCode: marketCategory === 'featured' ? undefined : marketCategory,
      });
      if (seq !== appsRequestSeq) return;
      if (reset) {
        set({
          apps: result.items,
          total: result.total,
          pageNum: result.pageNum,
          loading: false,
          error: null,
        });
      } else {
        const seen = new Set(currApps.map((a) => a.id));
        const appended = result.items.filter((a) => !seen.has(a.id));
        set({
          apps: [...currApps, ...appended],
          total: result.total,
          pageNum: result.pageNum,
          loadingMore: false,
          error: null,
        });
      }
    } catch (err) {
      if (seq !== appsRequestSeq) return;
      set({ error: toError(err), loading: false, loadingMore: false });
    }
  },

  loadMoreApps: async () => {
    const { apps, total, loading, loadingMore } = get();
    if (loading || loadingMore) return;
    if (apps.length >= total) return;
    await get().fetchApps({ reset: false });
  },
}));
