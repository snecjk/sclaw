import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '@electron/api/context';

const { StoMemoryApiErrorMock, memoryCenterFetchMock, parseJsonBodyMock, sendJsonMock } = vi.hoisted(() => {
  class StoMemoryApiErrorMock extends Error {
    statusCode: number;

    constructor(message: string, statusCode: number) {
      super(message);
      this.name = 'StoMemoryApiError';
      this.statusCode = statusCode;
    }
  }
  return {
    StoMemoryApiErrorMock,
    memoryCenterFetchMock: vi.fn(),
    parseJsonBodyMock: vi.fn(),
    sendJsonMock: vi.fn(),
  };
});

vi.mock('@electron/services/sto-memory-api-fetch', () => ({
  StoMemoryApiError: StoMemoryApiErrorMock,
  memoryCenterFetchForSession: (...args: unknown[]) => memoryCenterFetchMock(...args),
  memoryCenterFetchForAi: vi.fn(),
  parseMemoryCenterErrorMessage: vi.fn(),
}));

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => parseJsonBodyMock(...args),
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

vi.mock('@electron/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { handleLearningCenterRoutes } from '@electron/api/routes/learning-center';

const req = { method: 'POST' } as IncomingMessage;
const res = {} as ServerResponse;
const ctx = {} as HostApiContext;

function urlFor(path: string): URL {
  return new URL(`http://127.0.0.1:3210${path}`);
}

describe('handleLearningCenterRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parseJsonBodyMock.mockResolvedValue({ data: { pageNum: 1, pageSize: 20 } });
    memoryCenterFetchMock.mockResolvedValue({ success: true, errCode: '200', data: { items: [] } });
  });

  it('proxies every whitelisted client route to memory-center v1', async () => {
    const routes = [
      'domain/page',
      'category/page',
      'tutorial/page',
      'case-template/page',
      'tutorial/detail',
      'case-template/detail',
      'case-template/use',
    ];
    for (const route of routes) {
      memoryCenterFetchMock.mockClear();
      const handled = await handleLearningCenterRoutes(req, res, urlFor(`/api/learning-center/${route}`), ctx);
      expect(handled).toBe(true);
      expect(memoryCenterFetchMock).toHaveBeenCalledWith(
        `/api/v1/learning-center/${route}`,
        expect.objectContaining({ method: 'POST' }),
      );
    }
  });

  it('forwards the data payload untouched and preserves string IDs', async () => {
    parseJsonBodyMock.mockResolvedValue({ data: { caseId: '92233720368547758070' } });
    await handleLearningCenterRoutes(req, res, urlFor('/api/learning-center/case-template/use'), ctx);

    const [, init] = memoryCenterFetchMock.mock.calls[0] as [string, { body: string }];
    expect(init.body).toBe('{"data":{"caseId":"92233720368547758070"}}');
    expect(sendJsonMock).toHaveBeenCalledWith(res, 200, { success: true, errCode: '200', data: { items: [] } });
  });

  it('re-envelopes upstream business failures with their status as errCode', async () => {
    memoryCenterFetchMock.mockRejectedValue(new StoMemoryApiErrorMock('没有教程权限', 403));
    await handleLearningCenterRoutes(req, res, urlFor('/api/learning-center/tutorial/detail'), ctx);

    expect(sendJsonMock).toHaveBeenCalledWith(res, 200, {
      success: false,
      errCode: '403',
      errMessage: '没有教程权限',
      data: null,
    });
  });

  it('re-envelopes unexpected errors as 500 without leaking a thrown response', async () => {
    memoryCenterFetchMock.mockRejectedValue(new Error('socket hang up'));
    await handleLearningCenterRoutes(req, res, urlFor('/api/learning-center/domain/page'), ctx);

    expect(sendJsonMock).toHaveBeenCalledWith(res, 200, {
      success: false,
      errCode: '500',
      errMessage: 'socket hang up',
      data: null,
    });
  });

  it('rejects payloads without a data object before contacting memory-center', async () => {
    for (const body of [{}, { data: null }, { data: [1] }, { data: 'x' }]) {
      parseJsonBodyMock.mockResolvedValue(body);
      sendJsonMock.mockClear();
      await handleLearningCenterRoutes(req, res, urlFor('/api/learning-center/domain/page'), ctx);
      expect(sendJsonMock).toHaveBeenCalledWith(res, 200, expect.objectContaining({ success: false, errCode: '400' }));
    }
    expect(memoryCenterFetchMock).not.toHaveBeenCalled();
  });

  it('ignores non-whitelisted paths and non-POST methods', async () => {
    expect(await handleLearningCenterRoutes(req, res, urlFor('/api/learning-center/domain/save'), ctx)).toBe(false);
    expect(await handleLearningCenterRoutes(req, res, urlFor('/api/learning-center/admin/domain/page'), ctx)).toBe(false);
    expect(await handleLearningCenterRoutes(
      { method: 'GET' } as IncomingMessage,
      res,
      urlFor('/api/learning-center/domain/page'),
      ctx,
    )).toBe(false);
    expect(memoryCenterFetchMock).not.toHaveBeenCalled();
    expect(sendJsonMock).not.toHaveBeenCalled();
  });
});
