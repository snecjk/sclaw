/**
 * More Apps Store — manages 应用广场 UI state and localStorage persistence
 * Aligned with the PRD demo (more-apps.js)
 */
import { create } from 'zustand';
import type { AppItem, MoreAppsTab, MoreAppsSortMode, MarketCategory } from '@/types/more-apps';
import { VISIBLE_BUILTIN_APPS } from '@/components/more-apps/builtin-apps';

const STORAGE_KEY_EXTERNAL = 'stoclaw:more-apps:external';
const STORAGE_KEY_INSTALLED = 'stoclaw:more-apps:installed';
const STORAGE_KEY_FAVORITES = 'stoclaw:more-apps:favorites';

// ── localStorage helpers ──────────────────────────────────────────
function loadExternalApps(): AppItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_EXTERNAL);
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

function saveExternalApps(apps: AppItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_EXTERNAL, JSON.stringify(apps));
  } catch {
    // ignore
  }
}

function loadInstalled(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_INSTALLED);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveInstalled(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_INSTALLED, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FAVORITES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveFavorites(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_FAVORITES, JSON.stringify(ids));
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

  // Data
  builtinApps: AppItem[];
  externalApps: AppItem[];
  installedIds: string[];
  favoriteIds: string[];

  // Modal
  addModalOpen: boolean;
  editingExternalAppId: string | null;

  // Actions
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

export const useMoreAppsStore = create<MoreAppsState>((set, get) => ({
  activeTab: 'market',
  searchQuery: '',
  sortMode: 'default',
  marketCategory: 'featured',
  heroSlideIndex: 0,

  builtinApps: VISIBLE_BUILTIN_APPS,
  externalApps: loadExternalApps(),
  installedIds: loadInstalled(),
  favoriteIds: loadFavorites(),

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
    saveExternalApps(updated);
    // Also add to installed
    const updatedInstalled = [...get().installedIds, id];
    saveInstalled(updatedInstalled);
    set({ 
      externalApps: updated, 
      installedIds: updatedInstalled,
      addModalOpen: false,
      editingExternalAppId: null,
    });
  },

  updateExternalApp: (id, { name, url, description }) => {
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
    saveExternalApps(updated);
    set({
      externalApps: updated,
      addModalOpen: false,
      editingExternalAppId: null,
    });
  },

  removeExternalApp: (id) => {
    const updated = get().externalApps.filter((a) => a.id !== id);
    saveExternalApps(updated);
    const updatedInstalled = get().installedIds.filter((x) => x !== id);
    saveInstalled(updatedInstalled);
    const updatedFavorites = get().favoriteIds.filter((x) => x !== id);
    saveFavorites(updatedFavorites);
    set({
      externalApps: updated,
      installedIds: updatedInstalled,
      favoriteIds: updatedFavorites,
    });
  },

  installApp: (id) => {
    const installedIds = get().installedIds;
    if (installedIds.indexOf(id) === -1) {
      const updated = [...installedIds, id];
      saveInstalled(updated);
      set({ installedIds: updated });
    }
  },

  uninstallApp: (id) => {
    const updated = get().installedIds.filter((x) => x !== id);
    saveInstalled(updated);
    set({ installedIds: updated });
  },

  isAppInstalled: (id) => {
    return get().installedIds.indexOf(id) !== -1;
  },

  toggleFavorite: (id) => {
    const favoriteIds = get().favoriteIds;
    if (favoriteIds.indexOf(id) !== -1) {
      const updated = favoriteIds.filter((x) => x !== id);
      saveFavorites(updated);
      set({ favoriteIds: updated });
    } else {
      const updated = [...favoriteIds, id];
      saveFavorites(updated);
      set({ favoriteIds: updated });
    }
  },

  isAppFavorite: (id) => {
    return get().favoriteIds.indexOf(id) !== -1;
  },
}));
