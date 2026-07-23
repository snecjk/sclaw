import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchAppsMock = vi.fn();
const fetchCategoriesMock = vi.fn();
const fetchBannersMock = vi.fn();
const fetchRegistryMock = vi.fn();
const saveRegistryMock = vi.fn();
const migrateRegistryMock = vi.fn();

vi.mock('@/lib/app-plaza-api', () => ({
  fetchAppPlazaApps: (...args: unknown[]) => fetchAppsMock(...args),
  fetchAppPlazaCategories: (...args: unknown[]) => fetchCategoriesMock(...args),
  fetchAppPlazaBanners: (...args: unknown[]) => fetchBannersMock(...args),
}));

vi.mock('@/lib/more-apps-api', () => ({
  fetchMoreAppsRegistry: (...args: unknown[]) => fetchRegistryMock(...args),
  saveMoreAppsRegistry: (...args: unknown[]) => saveRegistryMock(...args),
  migrateMoreAppsRegistry: (...args: unknown[]) => migrateRegistryMock(...args),
}));

import { useMoreAppsStore } from '@/stores/more-apps';

describe('more apps store', () => {
  beforeEach(() => {
    localStorage.clear();
    fetchAppsMock.mockReset().mockResolvedValue({ items: [], total: 0, pageNum: 1, pageSize: 20 });
    fetchCategoriesMock.mockReset().mockResolvedValue([]);
    fetchBannersMock.mockReset().mockResolvedValue([]);
    fetchRegistryMock.mockReset().mockResolvedValue({
      version: 1,
      externalApps: [],
      installedIds: [],
      favoriteIds: [],
    });
    saveRegistryMock.mockReset().mockImplementation(async (registry) => registry);
    migrateRegistryMock.mockReset().mockImplementation(async (registry) => ({
      migrated: true,
      registry,
    }));
    useMoreAppsStore.setState({
      activeTab: 'market',
      searchQuery: '',
      marketCategory: 'featured',
      apps: [],
      catalogApps: [],
      categories: [],
      banners: [],
      externalApps: [],
      favoriteIds: [],
      installedIds: [],
      hydrated: false,
      hydrating: false,
      marketTotal: 0,
      total: 0,
      pageNum: 0,
      loading: false,
      loadingMore: false,
      error: null,
    });
  });

  it('loads the server catalog and forwards filters', async () => {
    await useMoreAppsStore.getState().hydrate();
    useMoreAppsStore.getState().setSearchQuery('客户');
    useMoreAppsStore.getState().setMarketCategory('org');
    await useMoreAppsStore.getState().fetchApps({ reset: true });
    expect(fetchAppsMock).toHaveBeenLastCalledWith({
      pageNum: 1,
      pageSize: 20,
      keyword: '客户',
      categoryCode: 'org',
    });
  });

  it('appends pages by id without duplicating apps', async () => {
    fetchAppsMock
      .mockResolvedValueOnce({
        items: [{ id: 'a', name: 'A', url: 'https://a.example', kind: 'builtin' }],
        total: 2,
        pageNum: 1,
        pageSize: 20,
      })
      .mockResolvedValueOnce({
        items: [
          { id: 'a', name: 'A', url: 'https://a.example', kind: 'builtin' },
          { id: 'b', name: 'B', url: 'https://b.example', kind: 'builtin' },
        ],
        total: 2,
        pageNum: 2,
        pageSize: 20,
      });
    await useMoreAppsStore.getState().fetchApps({ reset: true });
    await useMoreAppsStore.getState().loadMoreApps();
    expect(useMoreAppsStore.getState().apps.map((app) => app.id)).toEqual(['a', 'b']);
    expect(fetchAppsMock).toHaveBeenLastCalledWith(expect.objectContaining({ pageNum: 2 }));
  });

  it('keeps banner/category/app failures independent', async () => {
    fetchBannersMock.mockRejectedValueOnce(new Error('banner unavailable'));
    fetchCategoriesMock.mockResolvedValueOnce([{ id: 'org', name: '组织管理', order: 1 }]);
    fetchAppsMock.mockResolvedValueOnce({
      items: [{ id: 'a', name: 'A', url: 'https://a.example', kind: 'builtin' }],
      total: 1,
      pageNum: 1,
      pageSize: 20,
    });
    await Promise.all([
      useMoreAppsStore.getState().fetchBanners(),
      useMoreAppsStore.getState().fetchCategories(),
      useMoreAppsStore.getState().fetchApps({ reset: true }),
    ]);
    expect(useMoreAppsStore.getState().bannersError).toContain('banner unavailable');
    expect(useMoreAppsStore.getState().categories).toEqual([
      expect.objectContaining({ id: 'org' }),
    ]);
    expect(useMoreAppsStore.getState().apps).toEqual([
      expect.objectContaining({ id: 'a' }),
    ]);
    expect(useMoreAppsStore.getState().error).toBeNull();
  });

  it('persists favorites through main-backed registry', async () => {
    await useMoreAppsStore.getState().hydrate();
    useMoreAppsStore.getState().toggleFavorite('app-a');
    expect(useMoreAppsStore.getState().favoriteIds).toEqual(['app-a']);
    expect(saveRegistryMock).toHaveBeenLastCalledWith({
      version: 1,
      externalApps: [],
      installedIds: [],
      favoriteIds: ['app-a'],
    });
  });

  it('keeps the market badge total when a category query changes the list total', async () => {
    fetchAppsMock
      .mockResolvedValueOnce({ items: [], total: 8, pageNum: 1, pageSize: 20 })
      .mockResolvedValueOnce({ items: [], total: 3, pageNum: 1, pageSize: 20 });

    await useMoreAppsStore.getState().fetchApps({ reset: true });
    expect(useMoreAppsStore.getState().marketTotal).toBe(8);

    useMoreAppsStore.getState().setMarketCategory('org');
    await useMoreAppsStore.getState().fetchApps({ reset: true });
    expect(useMoreAppsStore.getState().total).toBe(3);
    expect(useMoreAppsStore.getState().marketTotal).toBe(8);
  });

  it('keeps a stable catalog snapshot when category results replace the market list', async () => {
    const featuredApp = { id: 'featured-app', name: 'Featured', url: 'https://featured.example', kind: 'builtin' as const };
    const categoryApp = { id: 'category-app', name: 'Category', url: 'https://category.example', kind: 'builtin' as const };
    fetchAppsMock
      .mockResolvedValueOnce({ items: [featuredApp], total: 1, pageNum: 1, pageSize: 20 })
      .mockResolvedValueOnce({ items: [categoryApp], total: 1, pageNum: 1, pageSize: 20 });

    await useMoreAppsStore.getState().fetchApps({ reset: true });
    useMoreAppsStore.getState().setMarketCategory('org');
    await useMoreAppsStore.getState().fetchApps({ reset: true });

    expect(useMoreAppsStore.getState().apps.map((app) => app.id)).toEqual(['category-app']);
    expect(useMoreAppsStore.getState().catalogApps.map((app) => app.id)).toEqual([
      'featured-app',
      'category-app',
    ]);
  });
});
