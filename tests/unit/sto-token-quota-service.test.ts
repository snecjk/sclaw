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
