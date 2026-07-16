import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

import {
  adaptAppPlazaApp,
  adaptAppPlazaBanner,
  adaptAppPlazaCategory,
  fetchAppPlazaApps,
  fetchAppPlazaBanners,
  fetchAppPlazaCategories,
  safeWebUrl,
} from '@/lib/app-plaza-api';

describe('app plaza renderer API adapter', () => {
  beforeEach(() => hostApiFetchMock.mockReset());

  it('normalizes backend apps and rejects unsafe URLs', () => {
    expect(adaptAppPlazaApp({ id: 'bad', name: 'Bad', url: 'javascript:alert(1)' })).toBeNull();
    expect(safeWebUrl('file:///tmp/a')).toBe('');
    expect(adaptAppPlazaApp({
      id: 'app-a',
      name: 'App A',
      url: 'https://example.com/app',
      tone: 'unknown',
      kind: 'unexpected',
      categoryCode: 'ops',
    })).toMatchObject({
      id: 'app-a',
      tone: 'gray',
      kind: 'builtin',
      categoryCode: 'ops',
    });
  });

  it('disables unsafe URL banners', () => {
    expect(adaptAppPlazaBanner({
      id: 'banner-a',
      targetType: 'URL',
      targetUrl: 'data:text/html,bad',
    })).toMatchObject({ targetType: 'URL', targetUrl: '' });
  });

  it('maps category id/name and preserves server ordering', async () => {
    expect(adaptAppPlazaCategory({ id: 'org', name: '组织管理', order: 2 })).toMatchObject({
      id: 'org',
      name: '组织管理',
      order: 2,
    });
    hostApiFetchMock.mockResolvedValue({
      success: true,
      data: [
        { id: 'ops', name: '经营管理', order: 20 },
        { id: 'org', name: '组织管理', order: 10 },
      ],
    });
    await expect(fetchAppPlazaCategories()).resolves.toEqual([
      expect.objectContaining({ id: 'org', name: '组织管理' }),
      expect.objectContaining({ id: 'ops', name: '经营管理' }),
    ]);
    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/app-plaza/categories');
  });

  it('loads whole-image banners and sanitizes click targets', async () => {
    hostApiFetchMock.mockResolvedValue({
      success: true,
      data: [{
        id: 'banner-a',
        title: '活动',
        imageUrl: 'https://cdn.example.com/banner.png',
        targetType: 'URL',
        targetUrl: 'https://example.com/activity',
        order: 1,
      }],
    });
    await expect(fetchAppPlazaBanners()).resolves.toEqual([
      expect.objectContaining({
        id: 'banner-a',
        imageUrl: 'https://cdn.example.com/banner.png',
        targetUrl: 'https://example.com/activity',
      }),
    ]);
    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/app-plaza/banners');
  });

  it('passes server-side paging and filters through Host API', async () => {
    hostApiFetchMock.mockResolvedValue({
      success: true,
      data: { items: [], total: 0, pageNum: 2, pageSize: 20 },
    });
    await fetchAppPlazaApps({ pageNum: 2, pageSize: 20, keyword: '客户', categoryCode: 'org' });
    expect(hostApiFetchMock).toHaveBeenCalledWith(
      '/api/app-plaza/apps?pageNum=2&pageSize=20&keyword=%E5%AE%A2%E6%88%B7&categoryCode=org',
    );
  });
});
