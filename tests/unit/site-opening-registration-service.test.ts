import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolveStoBaseUrl: vi.fn() }));

vi.mock('../../electron/utils/sto-domain', () => ({ resolveStoBaseUrl: mocks.resolveStoBaseUrl }));
vi.mock('../../electron/utils/sto-memory-api-auth', () => ({
  buildStoMemoryCenterAuthHeaders: (token: string) => ({ stotoken: token }),
}));

describe('SiteOpeningRegistrationService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveStoBaseUrl.mockResolvedValue('https://memory.example');
  });

  it('queries current status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({
        success: true,
        data: {
          status: 'REGISTERED',
          statusName: '已登记，等待处理',
          sclawAccessAllowed: false,
          modelTenantEnabled: false,
          applicationNo: 'SCA001',
        },
      }),
    }));
    const { SiteOpeningRegistrationService } = await import(
      '../../electron/services/site-opening-registration-service'
    );

    const result = await new SiteOpeningRegistrationService().getStatus('token');

    expect(result.status).toBe('REGISTERED');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/agent/v1/site-opening-status/current?clientCode=StoClaw'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('submits registration', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({
        success: true,
        data: { status: 'REGISTERED', statusName: '已登记，等待处理', applicationNo: 'SCA001' },
      }),
    }));
    const { SiteOpeningRegistrationService } = await import(
      '../../electron/services/site-opening-registration-service'
    );

    const result = await new SiteOpeningRegistrationService().register('token');

    expect(result.applicationNo).toBe('SCA001');
    expect(fetch).toHaveBeenCalledWith(
      'https://memory.example/sclaw/net/register',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ clientCode: 'StoClaw' }) }),
    );
  });
});
