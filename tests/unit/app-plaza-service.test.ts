import { beforeEach, describe, expect, it, vi } from 'vitest';

const memoryCenterFetchForSessionMock = vi.fn();

vi.mock('@electron/services/sto-memory-api-fetch', () => ({
  memoryCenterFetchForSession: (...args: unknown[]) => memoryCenterFetchForSessionMock(...args),
  StoMemoryApiError: class StoMemoryApiError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

import { AppPlazaService } from '@electron/services/app-plaza-service';

describe('AppPlazaService', () => {
  beforeEach(() => memoryCenterFetchForSessionMock.mockReset());

  it('uses the session-authenticated memory-center helper for app queries', async () => {
    memoryCenterFetchForSessionMock.mockResolvedValue({
      success: true,
      data: { items: [], total: 0, pageNum: 1, pageSize: 20 },
    });
    const service = new AppPlazaService();
    await service.listApps({ pageNum: 1, pageSize: 20, keyword: '客户', categoryCode: 'org' });
    expect(memoryCenterFetchForSessionMock).toHaveBeenCalledWith(
      '/agent/v1/app-plaza/apps?pageNum=1&pageSize=20&keyword=%E5%AE%A2%E6%88%B7&categoryCode=org',
      { method: 'POST' },
    );
  });

  it.each([
    ['listCategories', '/agent/v1/app-plaza/categories'],
    ['listBanners', '/agent/v1/app-plaza/banners'],
  ] as const)('proxies %s', async (method, path) => {
    memoryCenterFetchForSessionMock.mockResolvedValue({ success: true, data: [] });
    const service = new AppPlazaService();
    await service[method]();
    expect(memoryCenterFetchForSessionMock).toHaveBeenCalledWith(path, { method: 'POST' });
  });

  it('exchanges skip-login link by systemCode', async () => {
    memoryCenterFetchForSessionMock.mockResolvedValue({
      success: true,
      data: 'https://sso.example.com/Authenticate/Login?code=abc',
    });
    const service = new AppPlazaService();
    await expect(service.getSkipLoginLink('JIUTIAN')).resolves.toEqual({
      success: true,
      data: 'https://sso.example.com/Authenticate/Login?code=abc',
    });
    expect(memoryCenterFetchForSessionMock).toHaveBeenCalledWith(
      '/agent/v1/app-plaza/skip-login-link?systemCode=JIUTIAN',
      { method: 'POST' },
    );
  });
});
