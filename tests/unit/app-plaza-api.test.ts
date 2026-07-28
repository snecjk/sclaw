import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

import {
  adaptAppPlazaApp,
  adaptAppPlazaBanner,
  adaptAppPlazaCategory,
  appendSkipLoginReturnUrl,
  fetchAppPlazaApps,
  fetchAppPlazaBanners,
  fetchAppPlazaCategories,
  fetchAppPlazaSkipLoginLink,
  safeWebUrl,
} from '@/lib/app-plaza-api';

describe('app plaza renderer API adapter', () => {
  beforeEach(() => hostApiFetchMock.mockReset());

  it('normalizes backend apps and preserves server-provided URLs', () => {
    expect(adaptAppPlazaApp({ id: 'relative', name: 'Relative', url: 'customer-quote.html' })).toMatchObject({
      id: 'relative',
      url: 'customer-quote.html',
    });
    expect(adaptAppPlazaApp({ id: 'scheme', name: 'Scheme', url: 'custom-app://open' })).toMatchObject({
      id: 'scheme',
      url: 'custom-app://open',
    });
    expect(safeWebUrl('file:///tmp/a')).toBe('');
    expect(adaptAppPlazaApp({
      id: 'app-a',
      name: 'App A',
      url: 'https://example.com/app',
      systemCode: 'JIUTIAN',
      tone: 'unknown',
      kind: 'unexpected',
      categoryCode: 'ops',
    })).toMatchObject({
      id: 'app-a',
      tone: 'gray',
      kind: 'builtin',
      categoryCode: 'ops',
      systemCode: 'JIUTIAN',
    });
  });

  it('keeps renderable apps even when the server URL is empty', () => {
    expect(adaptAppPlazaApp({ id: 'display-only', name: 'Display Only', url: '' })).toMatchObject({
      id: 'display-only',
      name: 'Display Only',
      url: '',
    });
  });

  it('disables unsafe URL banners', () => {
    expect(adaptAppPlazaBanner({
      id: 'banner-a',
      targetType: 'URL',
      targetUrl: 'data:text/html,bad',
    })).toMatchObject({ targetType: 'URL', targetUrl: '' });
  });

  it('appends returnUrl onto skip-login ticket URLs', () => {
    expect(appendSkipLoginReturnUrl(
      'https://sso.example.com/Authenticate/Login?systemCode=JIUTIAN&code=abc',
      'https://jiutian.example.com/home',
    )).toBe(
      'https://sso.example.com/Authenticate/Login?systemCode=JIUTIAN&code=abc&returnUrl=https%3A%2F%2Fjiutian.example.com%2Fhome',
    );
    expect(appendSkipLoginReturnUrl('https://sso.example.com/Login', 'javascript:alert(1)')).toBe(
      'https://sso.example.com/Login',
    );
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

  it('fetches skip-login link by systemCode', async () => {
    hostApiFetchMock.mockResolvedValue({
      success: true,
      data: 'https://sso.example.com/Authenticate/Login?code=xyz',
    });
    await expect(fetchAppPlazaSkipLoginLink('JIUTIAN')).resolves.toBe(
      'https://sso.example.com/Authenticate/Login?code=xyz',
    );
    expect(hostApiFetchMock).toHaveBeenCalledWith(
      '/api/app-plaza/skip-login-link?systemCode=JIUTIAN',
    );
  });
});
