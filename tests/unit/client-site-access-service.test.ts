/**
 * Client Site Access Service Tests
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

vi.mock('../../electron/utils/sto-domain', () => ({
  resolveStoBaseUrl: vi.fn().mockResolvedValue('https://baseinfo-aimemory-test.sto.cn'),
}));

describe('requiresClientSiteAccessCheck', () => {
  it('returns true only for site organization categories', async () => {
    const { requiresClientSiteAccessCheck } = await import('../../shared/client-site-access');
    expect(requiresClientSiteAccessCheck('独立网点')).toBe(true);
    expect(requiresClientSiteAccessCheck('承包区')).toBe(true);
    expect(requiresClientSiteAccessCheck(' 网点部门 ')).toBe(true);
    expect(requiresClientSiteAccessCheck('总公司')).toBe(false);
    expect(requiresClientSiteAccessCheck('')).toBe(false);
    expect(requiresClientSiteAccessCheck(null)).toBe(false);
    expect(requiresClientSiteAccessCheck(undefined)).toBe(false);
  });
});

describe('ClientSiteAccessService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
  });

  it('parseClientSiteAccessResponse allows when success and data.allowed=true', async () => {
    const { parseClientSiteAccessResponse } = await import(
      '../../electron/services/client-site-access-service'
    );
    const result = parseClientSiteAccessResponse({
      success: true,
      errCode: '200',
      errMessage: 'OK',
      data: {
        client_code: 'StoClaw',
        allowed: true,
        categoryCode: '承包区',
        companyCode: '000030',
      },
    });
    expect(result.allowed).toBe(true);
    expect(result.companyCode).toBe('000030');
  });

  it('parseClientSiteAccessResponse denies when success and data.allowed=false', async () => {
    const { parseClientSiteAccessResponse } = await import(
      '../../electron/services/client-site-access-service'
    );
    const result = parseClientSiteAccessResponse({
      success: true,
      errCode: '200',
      data: {
        client_code: 'StoClaw',
        allowed: false,
        categoryCode: '独立网点',
        companyCode: '000099',
      },
    });
    expect(result.allowed).toBe(false);
    expect(result.companyCode).toBe('000099');
  });

  it('parseClientSiteAccessResponse fail-closed when success=false', async () => {
    const { parseClientSiteAccessResponse } = await import(
      '../../electron/services/client-site-access-service'
    );
    const result = parseClientSiteAccessResponse({
      success: false,
      errCode: '404',
      errMessage: "客户端 'StoClaw' 未在字典中配置",
      data: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.errCode).toBe('404');
  });

  it('parseClientSiteAccessResponse fail-closed on malformed payload', async () => {
    const { parseClientSiteAccessResponse } = await import(
      '../../electron/services/client-site-access-service'
    );
    const result = parseClientSiteAccessResponse(null);
    expect(result.allowed).toBe(false);
    expect(result.errCode).toBe('MALFORMED');
  });

  it('checkAccess returns allowed=true from API', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        errCode: '200',
        data: { client_code: 'StoClaw', allowed: true, categoryCode: '总公司', companyCode: '2155' },
      }),
    });

    const { getClientSiteAccessService } = await import(
      '../../electron/services/client-site-access-service'
    );
    const result = await getClientSiteAccessService().checkAccess('test-token');

    expect(result.allowed).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/agent/v1/client-site-configs/StoClaw/access-check'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ stotoken: 'test-token' }),
      }),
    );
  });

  it('checkAccess skips fetch for non-site categoryCode', async () => {
    const { getClientSiteAccessService } = await import(
      '../../electron/services/client-site-access-service'
    );
    const result = await getClientSiteAccessService().checkAccess('test-token', {
      categoryCode: '总公司',
    });

    expect(result.allowed).toBe(true);
    expect(result.errCode).toBe('200');
    expect(result.categoryCode).toBe('总公司');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checkAccess still fetches for site categoryCode', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        errCode: '200',
        data: {
          client_code: 'StoClaw',
          allowed: true,
          categoryCode: '独立网点',
          companyCode: '000030',
        },
      }),
    });

    const { getClientSiteAccessService } = await import(
      '../../electron/services/client-site-access-service'
    );
    const result = await getClientSiteAccessService().checkAccess('test-token', {
      categoryCode: '独立网点',
    });

    expect(result.allowed).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('checkAccess fail-closed on network error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    const { getClientSiteAccessService } = await import(
      '../../electron/services/client-site-access-service'
    );
    const result = await getClientSiteAccessService().checkAccess('test-token');

    expect(result.allowed).toBe(false);
    expect(result.errCode).toBe('NETWORK');
  });

  it('checkAccess fail-closed when stoToken is empty', async () => {
    const { getClientSiteAccessService } = await import(
      '../../electron/services/client-site-access-service'
    );
    const result = await getClientSiteAccessService().checkAccess('  ');

    expect(result.allowed).toBe(false);
    expect(result.errCode).toBe('401');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
