import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '@electron/api/context';

const listAppsMock = vi.fn();
const listCategoriesMock = vi.fn();
const listBannersMock = vi.fn();
const sendJsonMock = vi.fn();

vi.mock('@electron/services/app-plaza-service', () => ({
  getAppPlazaService: () => ({
    listApps: (...args: unknown[]) => listAppsMock(...args),
    listCategories: (...args: unknown[]) => listCategoriesMock(...args),
    listBanners: (...args: unknown[]) => listBannersMock(...args),
  }),
}));

vi.mock('@electron/services/sto-memory-api-fetch', () => ({
  StoMemoryApiError: class StoMemoryApiError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@electron/api/route-utils', () => ({
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

import { handleAppPlazaRoutes } from '@electron/api/routes/app-plaza';

const ctx = {} as HostApiContext;
const res = {} as ServerResponse;

describe('app plaza Host API routes', () => {
  beforeEach(() => {
    listAppsMock.mockReset();
    listCategoriesMock.mockReset();
    listBannersMock.mockReset();
    sendJsonMock.mockReset();
  });

  it('forwards app paging and filters', async () => {
    const payload = { success: true, data: { items: [], total: 0, pageNum: 2, pageSize: 30 } };
    listAppsMock.mockResolvedValue(payload);
    const handled = await handleAppPlazaRoutes(
      { method: 'GET' } as IncomingMessage,
      res,
      new URL('http://localhost/api/app-plaza/apps?pageNum=2&pageSize=30&keyword=a&categoryCode=ops'),
      ctx,
    );
    expect(handled).toBe(true);
    expect(listAppsMock).toHaveBeenCalledWith({
      pageNum: 2,
      pageSize: 30,
      keyword: 'a',
      categoryCode: 'ops',
    });
    expect(sendJsonMock).toHaveBeenCalledWith(res, 200, payload);
  });

  it.each([
    ['/api/app-plaza/categories', listCategoriesMock],
    ['/api/app-plaza/banners', listBannersMock],
  ])('handles %s', async (path, requestMock) => {
    requestMock.mockResolvedValue({ success: true, data: [] });
    expect(await handleAppPlazaRoutes(
      { method: 'GET' } as IncomingMessage,
      res,
      new URL(`http://localhost${path}`),
      ctx,
    )).toBe(true);
  });
});
