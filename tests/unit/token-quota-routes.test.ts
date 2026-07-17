import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const checkTokenQuotaMock = vi.fn();
const sendJsonMock = vi.fn();
const getUserSkDetailMock = vi.fn();
const applyHqExpansionMock = vi.fn();
const applySiteExpansionMock = vi.fn();
const resolveUserTypeMock = vi.fn();

vi.mock('@electron/services/sto-token-quota-service', () => ({
  getStoTokenQuotaService: () => ({
    checkTokenQuota: (...args: unknown[]) => checkTokenQuotaMock(...args),
  }),
}));

vi.mock('@electron/services/user-sk-service', () => ({
  getUserSkDetail: (...args: unknown[]) => getUserSkDetailMock(...args),
  getUserTokenQuotaTiers: vi.fn(),
}));

vi.mock('@electron/services/sto-site-memory-api-service', () => ({
  applySiteTokenQuotaExpansionViaMemoryCenter: (...args: unknown[]) => applySiteExpansionMock(...args),
  StoSiteMemoryApiError: class StoSiteMemoryApiError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@electron/services/sto-token-quota-expansion-apply-service', () => ({
  applyHqTokenQuotaExpansion: (...args: unknown[]) => applyHqExpansionMock(...args),
  StoTokenQuotaExpansionApplyError: class StoTokenQuotaExpansionApplyError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@electron/utils/auth-store', () => ({
  getAuthState: async () => ({
    user: {
      id: 'u1',
      empCode: 'E1001',
      code: 'W2002',
      realName: '张三',
      categoryCode: '总部',
      companyCode: 'C001',
      companyName: '公司',
      departmentCode: 'D001',
      departmentName: '部门',
      userName: 'zhang',
      companyId: '',
      departmentId: '',
      isAdministrator: false,
      loginMode: '',
      openId: '',
      signature: '',
      authenticatedAt: '',
    },
  }),
}));

vi.mock('@electron/services/sto-sk-strategy', () => ({
  resolveUserType: (...args: unknown[]) => resolveUserTypeMock(...args),
}));

vi.mock('@electron/api/route-utils', () => ({
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
  parseJsonBody: async (req: IncomingMessage) => (req as IncomingMessage & { __body?: unknown }).__body,
}));

const sampleTier = {
  level: 2,
  tierName: '标准套餐',
  quotaAmount: 500,
  needApproval: false,
  approverDesc: null,
  isDefault: false,
  applied: false,
  children: null,
};

const sampleTierContext = {
  tierList: [sampleTier],
  currentTier: '基础档',
  currentQuota: 300,
  totalExpandedQuota: 50,
};

describe('handleTokenQuotaRoutes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resolveUserTypeMock.mockResolvedValue('hq');
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

  it('proxies hq POST /api/token-quota/expansion to memory-center', async () => {
    applyHqExpansionMock.mockResolvedValueOnce(undefined);
    const { handleTokenQuotaRoutes } = await import('@electron/api/routes/token-quota');
    const req = {
      method: 'POST',
      __body: {
        tokenId: 'tk_1',
        quotaAmount: 500,
        tier: sampleTier,
        tierContext: sampleTierContext,
      },
    } as IncomingMessage & { __body?: unknown };

    const handled = await handleTokenQuotaRoutes(
      req,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/token-quota/expansion'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(applyHqExpansionMock).toHaveBeenCalledTimes(1);
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, { success: true });
  });

  it('returns 400 when hq payload misses tierContext', async () => {
    const { handleTokenQuotaRoutes } = await import('@electron/api/routes/token-quota');
    const req = {
      method: 'POST',
      __body: { tokenId: 'tk_1', quotaAmount: 500, tier: sampleTier },
    } as IncomingMessage & { __body?: unknown };

    await handleTokenQuotaRoutes(
      req,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/token-quota/expansion'),
      {} as never,
    );

    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      400,
      { error: 'tierContext is required' },
    );
    expect(applyHqExpansionMock).not.toHaveBeenCalled();
  });

  it('proxies site POST /api/token-quota/expansion to memory-center', async () => {
    resolveUserTypeMock.mockResolvedValueOnce('site');
    applySiteExpansionMock.mockResolvedValueOnce(undefined);

    const { handleTokenQuotaRoutes } = await import('@electron/api/routes/token-quota');
    const req = { method: 'POST', __body: { tokenId: 'tk_1', quotaAmount: 200 } } as IncomingMessage & {
      __body?: unknown;
    };

    await handleTokenQuotaRoutes(
      req,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/token-quota/expansion'),
      {} as never,
    );

    expect(applyHqExpansionMock).not.toHaveBeenCalled();
    expect(applySiteExpansionMock).toHaveBeenCalledWith({
      tokenId: 'tk_1',
      quotaAmount: 200,
      clientEventId: undefined,
    });
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, { success: true });
  });
});
