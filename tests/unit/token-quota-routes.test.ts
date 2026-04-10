import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const checkTokenQuotaMock = vi.fn();
const sendJsonMock = vi.fn();

vi.mock('@electron/services/sto-token-quota-service', () => ({
  getStoTokenQuotaService: () => ({
    checkTokenQuota: (...args: unknown[]) => checkTokenQuotaMock(...args),
  }),
}));

vi.mock('@electron/api/route-utils', () => ({
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

describe('handleTokenQuotaRoutes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns the service result for GET /api/token-quota/check', async () => {
    checkTokenQuotaMock.mockResolvedValueOnce({ success: true, remaining: 12 });
    const { handleTokenQuotaRoutes } = await import('@electron/api/routes/token-quota');

    const handled = await handleTokenQuotaRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/token-quota/check'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(checkTokenQuotaMock).toHaveBeenCalledTimes(1);
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      { success: true, remaining: 12 },
    );
  });

  it('returns 500 when the service throws', async () => {
    checkTokenQuotaMock.mockRejectedValueOnce(new Error('boom'));
    const { handleTokenQuotaRoutes } = await import('@electron/api/routes/token-quota');

    await handleTokenQuotaRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/token-quota/check'),
      {} as never,
    );

    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      500,
      { success: false, error: 'Error: boom' },
    );
  });

  it('returns 401 for auth-like service errors', async () => {
    const authError = Object.assign(new Error('未登录或 stoToken 已过期，请重新登录'), {
      statusCode: 401,
    });
    checkTokenQuotaMock.mockRejectedValueOnce(authError);
    const { handleTokenQuotaRoutes } = await import('@electron/api/routes/token-quota');

    await handleTokenQuotaRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/token-quota/check'),
      {} as never,
    );

    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      401,
      { success: false, error: 'Error: 未登录或 stoToken 已过期，请重新登录' },
    );
  });

  it('returns the provided upstream status code when it is a valid HTTP error code', async () => {
    const upstreamError = Object.assign(new Error('Bad Gateway'), {
      statusCode: 502,
    });
    checkTokenQuotaMock.mockRejectedValueOnce(upstreamError);
    const { handleTokenQuotaRoutes } = await import('@electron/api/routes/token-quota');

    await handleTokenQuotaRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/token-quota/check'),
      {} as never,
    );

    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      502,
      { success: false, error: 'Error: Bad Gateway' },
    );
  });
});
