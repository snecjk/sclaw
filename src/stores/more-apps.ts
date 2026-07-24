/**
 * More Apps Store — server catalog + Main-backed local registry persistence.
 * Aligned with the PRD demo (more-apps.js)
 *
 * Market tab (Banner / 分类 / APP) is driven by server catalog state fetched via the
 * Main Host API proxy. The three blocks keep independent loading/error so one failure
 * does not break the others; APP supports reset, append pagination and request-race
 * protection. "我的应用"、收藏和外部应用 keep main's ~/.stoclaw/more-apps registry behavior.
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
import {
  fetchAppPlazaApps,
  fetchAppPlazaBanners,
  fetchAppPlazaCategories,
} from '@/lib/app-plaza-api';
import {
  fetchMoreAppsRegistry,
  migrateMoreAppsRegistry,
  saveMoreAppsRegistry,
} from '@/lib/more-apps-api';
import {
  createEmptyMoreAppsRegistry,
  isMoreAppsRegistryEmpty,
  MORE_APPS_REGISTRY_VERSION,
  type MoreAppsRegistry,
} from '../../shared/more-apps-registry';

const STORAGE_KEY_EXTERNAL = 'stoclaw:more-apps:external';
const STORAGE_KEY_INSTALLED = 'stoclaw:more-apps:installed';
const STORAGE_KEY_FAVORITES = 'stoclaw:more-apps:favorites';

const APP_PAGE_SIZE = 20;

// Request-sequence guards — a stale slow response is discarded when a newer
// reset/append has started, so the UI never shows out-of-order catalog results.
let appsRequestSeq = 0;
let bannersRequestSeq = 0;
let categoriesRequestSeq = 0;

function toError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Read main's legacy renderer storage once, then migrate it into the durable registry.
function readLegacyLocalStorage(): MoreAppsRegistry {
  const empty = createEmptyMoreAppsRegistry();
  try {
    const externalRaw = localStorage.getItem(STORAGE_KEY_EXTERNAL);
    const installedRaw = localStorage.getItem(STORAGE_KEY_INSTALLED);
    const favoritesRaw = localStorage.getItem(STORAGE_KEY_FAVORITES);
    if (!externalRaw && !installedRaw && !favoritesRaw) return empty;
    const externalParsed = externalRaw ? JSON.parse(externalRaw) : [];
    const installedParsed = installedRaw ? JSON.parse(installedRaw) : [];
    const favoritesParsed = favoritesRaw ? JSON.parse(favoritesRaw) : [];
    return {
      version: MORE_APPS_REGISTRY_VERSION,
      externalApps: Array.isArray(externalParsed)
        ? externalParsed.filter(
            (app: unknown): app is AppItem =>
              !!app && typeof app === 'object' &&
              typeof (app as AppItem).id === 'string' &&
              typeof (app as AppItem).url === 'string',
          )
        : [],
      installedIds: Array.isArray(installedParsed)
        ? installedParsed.filter((id): id is string => typeof id === 'string')
        : [],
      favoriteIds: Array.isArray(favoritesParsed)
        ? favoritesParsed.filter((id): id is string => typeof id === 'string')
        : [],
    };
  } catch {
    return empty;
  }
}

function clearLegacyLocalStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_EXTERNAL);
    localStorage.removeItem(STORAGE_KEY_INSTALLED);
    localStorage.removeItem(STORAGE_KEY_FAVORITES);
  } catch {
    // ignore
  }
}

function toRegistry(state: Pick<MoreAppsState, 'externalApps' | 'installedIds' | 'favoriteIds'>): MoreAppsRegistry {
  return {
    version: MORE_APPS_REGISTRY_VERSION,
    externalApps: state.externalApps,
    installedIds: state.installedIds,
    favoriteIds: state.favoriteIds,
  };
}

function asAppItems(apps: MoreAppsRegistry['externalApps']): AppItem[] {
  return apps.map((app) => ({
    ...app,
    tone: ['blue', 'orange', 'green', 'purple', 'teal', 'gray'].includes(app.tone ?? '')
      ? app.tone as AppItem['tone']
      : 'gray',
    kind: app.kind === 'builtin' ? 'builtin' : 'external',
    external: app.external ?? true,
  }));
}

function mergeAppItems(current: AppItem[], incoming: AppItem[]): AppItem[] {
  const merged = new Map(current.map((app) => [app.id, app]));
  incoming.forEach((app) => merged.set(app.id, app));
  return Array.from(merged.values());
}

// ── Store interface ────────────────────────────────────────────────
interface MoreAppsState {
  // UI state
  activeTab: MoreAppsTab;
  searchQuery: string;
  sortMode: MoreAppsSortMode;
  marketCategory: MarketCategory;
  heroSlideIndex: number;

  // Server catalog — Banner block (independent loading/error)
  banners: AppPlazaBanner[];
  bannersLoading: boolean;
  bannersError: string | null;

  // Server catalog — 分类 block (independent loading/error)
  categories: AppPlazaCategory[];
  categoryCounts: Record<string, number>;
  categoriesLoading: boolean;
  categoriesError: string | null;

  // Server catalog — APP block (independent loading/error, with pagination + race guard)
  apps: AppItem[];
  /** Stable session catalog used by 我的应用; market filters never remove entries. */
  catalogApps: AppItem[];
  /** Unfiltered catalog total shown beside the 应用广场 tab. */
  marketTotal: number;
  total: number;
  pageNum: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;

  // Main-backed local registry (same behavior as main).
  externalApps: AppItem[];
  installedIds: string[];
  favoriteIds: string[];
  hydrated: boolean;
  hydrating: boolean;

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

  // Actions — external / installed / favorites
  hydrate: () => Promise<void>;
  addExternalApp: (app: { name: string; url: string; description?: string }) => void;
  updateExternalApp: (id: string, app: { name: string; url: string; description?: string }) => void;
  removeExternalApp: (id: string) => void;
  installApp: (id: string) => void;
  uninstallApp: (id: string) => void;
  isAppInstalled: (id: string) => boolean;
  toggleFavorite: (id: string) => void;
  isAppFavorite: (id: string) => boolean;

  // Actions — server catalog
  fetchBanners: () => Promise<void>;
  fetchCategories: () => Promise<void>;
  fetchApps: (opts?: { reset?: boolean }) => Promise<void>;
  loadMoreApps: () => Promise<void>;
}

async function persistRegistry(get: () => MoreAppsState): Promise<void> {
  const state = get();
  if (!state.hydrated) return;
  try {
    await saveMoreAppsRegistry(toRegistry(state));
  } catch (error) {
    console.error('[more-apps] persist failed', error);
  }
}

export const useMoreAppsStore = create<MoreAppsState>((set, get) => ({
  activeTab: 'market',
  searchQuery: '',
  sortMode: 'default',
  marketCategory: 'featured',
  heroSlideIndex: 0,

  banners: [],
  bannersLoading: false,
  bannersError: null,

  categories: [],
  categoryCounts: {},
  categoriesLoading: false,
  categoriesError: null,

  apps: [],
  catalogApps: [],
  marketTotal: 0,
  total: 0,
  pageNum: 0,
  loading: false,
  loadingMore: false,
  error: null,

  externalApps: [],
  installedIds: [],
  favoriteIds: [],
  hydrated: false,
  hydrating: false,

  addModalOpen: false,
  editingExternalAppId: null,

  hydrate: async () => {
    const current = get();
    if (current.hydrated || current.hydrating) return;
    set({ hydrating: true });
    try {
      let registry = await fetchMoreAppsRegistry();
      const legacy = readLegacyLocalStorage();
      if (!isMoreAppsRegistryEmpty(legacy)) {
        try {
          const result = await migrateMoreAppsRegistry(legacy);
          registry = result.registry;
          if (result.migrated || !isMoreAppsRegistryEmpty(registry)) clearLegacyLocalStorage();
        } catch (error) {
          console.error('[more-apps] migrate failed', error);
        }
      }
      set({
        externalApps: asAppItems(registry.externalApps),
        installedIds: registry.installedIds,
        favoriteIds: registry.favoriteIds,
        hydrated: true,
        hydrating: false,
      });
    } catch (error) {
      console.error('[more-apps] hydrate failed', error);
      set({ hydrated: true, hydrating: false });
    }
  },

  setActiveTab: (tab) => set({ activeTab: tab, searchQuery: '' }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSortMode: (mode) => set({ sortMode: mode }),
  setMarketCategory: (cat) => set({ marketCategory: cat }),
  setHeroSlideIndex: (idx) => set({ heroSlideIndex: idx }),

  openAddModal: () => set({ addModalOpen: true, editingExternalAppId: null }),
  openEditModal: (id) => set({ addModalOpen: true, editingExternalAppId: id }),
  closeAddModal: () => set({ addModalOpen: false, editingExternalAppId: null }),

  addExternalApp: ({ name, url, description }) => {
    if (!get().hydrated) return;
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
    const updatedInstalled = [...get().installedIds, id];
    set({
      externalApps: updated,
      installedIds: updatedInstalled,
      addModalOpen: false,
      editingExternalAppId: null,
    });
    void persistRegistry(get);
  },

  updateExternalApp: (id, { name, url, description }) => {
    if (!get().hydrated) return;
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
    set({
      externalApps: updated,
      addModalOpen: false,
      editingExternalAppId: null,
    });
    void persistRegistry(get);
  },

  removeExternalApp: (id) => {
    if (!get().hydrated) return;
    const updated = get().externalApps.filter((a) => a.id !== id);
    const updatedInstalled = get().installedIds.filter((x) => x !== id);
    const updatedFavorites = get().favoriteIds.filter((x) => x !== id);
    set({
      externalApps: updated,
      installedIds: updatedInstalled,
      favoriteIds: updatedFavorites,
    });
    void persistRegistry(get);
  },

  installApp: (id) => {
    if (!get().hydrated) return;
    const installedIds = get().installedIds;
    if (installedIds.indexOf(id) === -1) {
      const updated = [...installedIds, id];
      set({ installedIds: updated });
      void persistRegistry(get);
    }
  },

  uninstallApp: (id) => {
    if (!get().hydrated) return;
    const updated = get().installedIds.filter((x) => x !== id);
    set({ installedIds: updated });
    void persistRegistry(get);
  },

  isAppInstalled: (id) => {
    return get().installedIds.indexOf(id) !== -1;
  },

  toggleFavorite: (id) => {
    if (!get().hydrated) return;
    const favoriteIds = get().favoriteIds;
    if (favoriteIds.indexOf(id) !== -1) {
      const updated = favoriteIds.filter((x) => x !== id);
      set({ favoriteIds: updated });
    } else {
      const updated = [...favoriteIds, id];
      set({ favoriteIds: updated });
    }
    void persistRegistry(get);
  },

  isAppFavorite: (id) => {
    return get().favoriteIds.indexOf(id) !== -1;
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

      const countResults = await Promise.allSettled(
        categories.map((category) =>
          fetchAppPlazaApps({
            pageNum: 1,
            pageSize: 1,
            categoryCode: category.id,
          }),
        ),
      );
      if (seq !== categoriesRequestSeq) return;
      const categoryCounts = countResults.reduce<Record<string, number>>((counts, result, index) => {
        const category = categories[index];
        if (result.status === 'fulfilled' && category) {
          counts[category.id] = result.value.total;
        }
        return counts;
      }, {});
      set({ categoryCounts });
    } catch (err) {
      if (seq !== categoriesRequestSeq) return;
      set({ categoriesError: toError(err), categoriesLoading: false, categoryCounts: {} });
    }
  },

  fetchApps: async (opts) => {
    const reset = opts?.reset ?? false;
    const seq = ++appsRequestSeq;
    const {
      searchQuery,
      marketCategory,
      pageNum: currPage,
      apps: currApps,
      catalogApps: currCatalogApps,
    } = get();
    const isUnfiltered = !searchQuery.trim() && marketCategory === 'featured';
    const isUnfilteredCategory = !searchQuery.trim() && marketCategory !== 'featured';
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
          catalogApps: mergeAppItems(currCatalogApps, result.items),
          ...(isUnfiltered ? { marketTotal: result.total } : {}),
          ...(isUnfilteredCategory
            ? { categoryCounts: { ...get().categoryCounts, [marketCategory]: result.total } }
            : {}),
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
          catalogApps: mergeAppItems(currCatalogApps, result.items),
          ...(isUnfiltered ? { marketTotal: result.total } : {}),
          ...(isUnfilteredCategory
            ? { categoryCounts: { ...get().categoryCounts, [marketCategory]: result.total } }
            : {}),
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
