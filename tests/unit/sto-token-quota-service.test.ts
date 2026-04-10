import { beforeEach, describe, expect, it, vi } from 'vitest';

const getStoTokenMock = vi.fn();
const getSsoEnvironmentMock = vi.fn();
const fetchMock = vi.fn();
const loggerInfoMock = vi.fn();

vi.mock('@electron/utils/auth-store', () => ({
  getStoToken: (...args: unknown[]) => getStoTokenMock(...args),
  getSsoEnvironment: (...args: unknown[]) => getSsoEnvironmentMock(...args),
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: (...args: unknown[]) => loggerInfoMock(...args),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('StoTokenQuotaService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    getSsoEnvironmentMock.mockResolvedValue('production-external');
  });

  it('throws an auth error when the sto token is missing', async () => {
    getStoTokenMock.mockResolvedValueOnce(null);
    const { StoTokenQuotaService } = await import('@electron/services/sto-token-quota-service');

    await expect(new StoTokenQuotaService().checkTokenQuota()).rejects.toMatchObject({
      message: '未登录或 stoToken 已过期，请重新登录',
      statusCode: 401,
    });
  });

  it('throws a clear error when the upstream response is unauthorized', async () => {
    getStoTokenMock.mockResolvedValueOnce('token-1');
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: async () => 'denied',
    });
    const { StoTokenQuotaService } = await import('@electron/services/sto-token-quota-service');

    await expect(new StoTokenQuotaService().checkTokenQuota()).rejects.toMatchObject({
      message: 'STO token quota check failed (403): denied',
      statusCode: 403,
    });
  });

  it('preserves upstream 429 status codes', async () => {
    getStoTokenMock.mockResolvedValueOnce('token-1');
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: async () => 'rate limited',
    });
    const { StoTokenQuotaService } = await import('@electron/services/sto-token-quota-service');

    await expect(new StoTokenQuotaService().checkTokenQuota()).rejects.toMatchObject({
      message: 'STO token quota check failed (429): rate limited',
      statusCode: 429,
    });
  });

  it('preserves upstream 502 status codes', async () => {
    getStoTokenMock.mockResolvedValueOnce('token-1');
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      text: async () => 'gateway error',
    });
    const { StoTokenQuotaService } = await import('@electron/services/sto-token-quota-service');

    await expect(new StoTokenQuotaService().checkTokenQuota()).rejects.toMatchObject({
      message: 'STO token quota check failed (502): gateway error',
      statusCode: 502,
    });
  });

  it('throws a clear error when the upstream payload is malformed', async () => {
    getStoTokenMock.mockResolvedValueOnce('token-1');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: null }),
    });
    const { StoTokenQuotaService } = await import('@electron/services/sto-token-quota-service');

    await expect(new StoTokenQuotaService().checkTokenQuota()).rejects.toThrow(
      'STO token quota response payload is malformed',
    );
  });
});
