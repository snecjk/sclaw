/**
 * More Apps Store — UI state + Main-backed persistence (~/.stoclaw/more-apps)
 */
import { create } from 'zustand';
import type { AppItem, AppTone, MoreAppsTab, MoreAppsSortMode, MarketCategory } from '@/types/more-apps';
import { VISIBLE_BUILTIN_APPS } from '@/components/more-apps/builtin-apps';
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

function readLegacyLocalStorage(): MoreAppsRegistry {
  const empty = createEmptyMoreAppsRegistry();
  try {
    const externalRaw = localStorage.getItem(STORAGE_KEY_EXTERNAL);
    const installedRaw = localStorage.getItem(STORAGE_KEY_INSTALLED);
    const favoritesRaw = localStorage.getItem(STORAGE_KEY_FAVORITES);
    if (!externalRaw && !installedRaw && !favoritesRaw) {
      return empty;
    }
    const externalParsed = externalRaw ? JSON.parse(externalRaw) : [];
    const installedParsed = installedRaw ? JSON.parse(installedRaw) : [];
    const favoritesParsed = favoritesRaw ? JSON.parse(favoritesRaw) : [];
    const externalApps = Array.isArray(externalParsed)
      ? externalParsed.filter(
          (a: unknown): a is AppItem =>
            !!a &&
            typeof a === 'object' &&
            typeof (a as AppItem).id === 'string' &&
            typeof (a as AppItem).url === 'string',
        )
      : [];
    return {
      version: MORE_APPS_REGISTRY_VERSION,
      externalApps,
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

function toRegistry(state: {
  externalApps: AppItem[];
  installedIds: string[];
  favoriteIds: string[];
}): MoreAppsRegistry {
  return {
    version: MORE_APPS_REGISTRY_VERSION,
    externalApps: state.externalApps,
    installedIds: state.installedIds,
    favoriteIds: state.favoriteIds,
  };
}

const APP_TONES = new Set<AppTone>(['blue', 'orange', 'green', 'purple', 'teal', 'gray']);

function normalizeAppTone(tone: string | undefined): AppTone | undefined {
  return tone && APP_TONES.has(tone as AppTone) ? tone as AppTone : undefined;
}

function asAppItems(apps: MoreAppsRegistry['externalApps']): AppItem[] {
  return apps.map((app) => ({
    ...app,
    name: app.name,
    url: app.url,
    kind: app.kind === 'builtin' ? 'builtin' : 'external',
    external: app.external ?? true,
    tone: normalizeAppTone(app.tone),
  }));
}

// ── Store interface ────────────────────────────────────────────────
interface MoreAppsState {
  // UI state
  activeTab: MoreAppsTab;
  searchQuery: string;
  sortMode: MoreAppsSortMode;
  marketCategory: MarketCategory;
  heroSlideIndex: number;

  // Data
  builtinApps: AppItem[];
  externalApps: AppItem[];
  installedIds: string[];
  favoriteIds: string[];
  hydrated: boolean;
  hydrating: boolean;

  // Modal
  addModalOpen: boolean;
  editingExternalAppId: string | null;

  // Actions
  hydrate: () => Promise<void>;
  setActiveTab: (tab: MoreAppsTab) => void;
  setSearchQuery: (q: string) => void;
  setSortMode: (mode: MoreAppsSortMode) => void;
  setMarketCategory: (cat: MarketCategory) => void;
  setHeroSlideIndex: (idx: number) => void;
  openAddModal: () => void;
  openEditModal: (id: string) => void;
  closeAddModal: () => void;
  addExternalApp: (app: { name: string; url: string; description?: string }) => void;
  updateExternalApp: (id: string, app: { name: string; url: string; description?: string }) => void;
  removeExternalApp: (id: string) => void;
  installApp: (id: string) => void;
  uninstallApp: (id: string) => void;
  isAppInstalled: (id: string) => boolean;
  toggleFavorite: (id: string) => void;
  isAppFavorite: (id: string) => boolean;
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

  builtinApps: VISIBLE_BUILTIN_APPS,
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
          const migrateResult = await migrateMoreAppsRegistry(legacy);
          registry = migrateResult.registry;
          if (migrateResult.migrated || !isMoreAppsRegistryEmpty(registry)) {
            clearLegacyLocalStorage();
          }
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
}));
