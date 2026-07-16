import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchAppsMock = vi.fn();
const fetchCategoriesMock = vi.fn();
const fetchBannersMock = vi.fn();

vi.mock('@/lib/app-plaza-api', () => ({
  fetchAppPlazaApps: (...args: unknown[]) => fetchAppsMock(...args),
  fetchAppPlazaCategories: (...args: unknown[]) => fetchCategoriesMock(...args),
  fetchAppPlazaBanners: (...args: unknown[]) => fetchBannersMock(...args),
}));

import { useMoreAppsStore } from '@/stores/more-apps';

describe('more apps store', () => {
  beforeEach(() => {
    localStorage.clear();
    fetchAppsMock.mockReset().mockResolvedValue({ items: [], total: 0, pageNum: 1, pageSize: 20 });
    fetchCategoriesMock.mockReset().mockResolvedValue([]);
    fetchBannersMock.mockReset().mockResolvedValue([]);
    useMoreAppsStore.setState({
      activeTab: 'market',
      searchQuery: '',
      marketCategory: 'featured',
      userCode: '',
      apps: [],
      categories: [],
      banners: [],
      externalApps: [],
      favoriteIds: [],
      total: 0,
      pageNum: 0,
      loading: false,
      loadingMore: false,
      error: null,
    });
  });

  it('loads the server catalog and forwards filters', async () => {
    await useMoreAppsStore.getState().initialize('u-1');
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
    await useMoreAppsStore.getState().initialize('u-1');
    expect(useMoreAppsStore.getState().bannersError).toContain('banner unavailable');
    expect(useMoreAppsStore.getState().categories).toEqual([
      expect.objectContaining({ id: 'org' }),
    ]);
    expect(useMoreAppsStore.getState().apps).toEqual([
      expect.objectContaining({ id: 'a' }),
    ]);
    expect(useMoreAppsStore.getState().error).toBeNull();
  });

  it('isolates external apps and favorites by user code', async () => {
    await useMoreAppsStore.getState().initialize('alice');
    useMoreAppsStore.getState().addExternalApp({ name: 'Alice App', url: 'https://example.com' });
    useMoreAppsStore.getState().toggleFavorite('app-a');

    await useMoreAppsStore.getState().initialize('bob');
    expect(useMoreAppsStore.getState().externalApps).toEqual([]);
    expect(useMoreAppsStore.getState().favoriteIds).toEqual([]);

    await useMoreAppsStore.getState().initialize('alice');
    expect(useMoreAppsStore.getState().externalApps[0]?.name).toBe('Alice App');
    expect(useMoreAppsStore.getState().favoriteIds).toEqual(['app-a']);
  });
});
