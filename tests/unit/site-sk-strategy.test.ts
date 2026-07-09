import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SsoUserInfo } from '@electron/utils/auth-store';

const mocks = vi.hoisted(() => ({
  ensureSiteKeyViaMemoryCenter: vi.fn(),
  getApiKey: vi.fn(),
  storeApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  hasSiteInferencePortalDomainCached: vi.fn().mockReturnValue(true),
  loadSiteInferencePortalDomain: vi.fn().mockResolvedValue(undefined),
  resolveSiteInferencePortalDomain: vi.fn(
    (env?: string | null) =>
      ['test', 'pre-release', 'daily', 'daily-external', 'local'].some((e) =>
        (env ?? '').toLowerCase().includes(e),
      )
        ? 'https://devops-llmgatewayleague-test.sto.cn'
        : 'https://devops-llmgatewayleague.sto.cn',
  ),
}));

vi.mock('@electron/services/sto-site-memory-api-service', () => ({
  ensureSiteKeyViaMemoryCenter: mocks.ensureSiteKeyViaMemoryCenter,
  StoSiteMemoryApiError: class extends Error {},
}));

vi.mock('@electron/utils/secure-storage', () => ({
  getApiKey: mocks.getApiKey,
  storeApiKey: mocks.storeApiKey,
  deleteApiKey: mocks.deleteApiKey,
}));

vi.mock('@electron/utils/auth-store', () => ({
  getSsoEnvironment: vi.fn().mockResolvedValue('production'),
}));

vi.mock('@electron/services/sto-apollo-config-service', () => ({
  hasSiteInferencePortalDomainCached: mocks.hasSiteInferencePortalDomainCached,
  loadSiteInferencePortalDomain: mocks.loadSiteInferencePortalDomain,
  resolveSiteInferencePortalDomain: mocks.resolveSiteInferencePortalDomain,
}));

import { SiteSkStrategy } from '@electron/services/sto-site-sk-strategy';
import crypto from 'crypto';

const siteUser: SsoUserInfo = {
  id: '2',
  userName: 'site',
  realName: 'Site',
  code: 'site001',
  empCode: 'site001',
  companyId: 'c1',
  companyCode: 'C001',
  companyName: 'Site Co',
  departmentId: 'd1',
  departmentCode: 'D001',
  departmentName: 'Dept',
  categoryCode: '独立网点',
  isAdministrator: false,
  loginMode: 'sso',
  openId: 'oid2',
  signature: 'sig',
  authenticatedAt: new Date().toISOString(),
};

describe('SiteSkStrategy', () => {
  let strategy: SiteSkStrategy;

  beforeEach(() => {
    vi.resetAllMocks();
    strategy = new SiteSkStrategy();
    mocks.getApiKey.mockResolvedValue(null);
    mocks.storeApiKey.mockResolvedValue(undefined);
    mocks.deleteApiKey.mockResolvedValue(undefined);
    mocks.hasSiteInferencePortalDomainCached.mockReturnValue(true);
  });

  it('getUserSk stores and returns plaintext apiKey from memory-center', async () => {
    mocks.ensureSiteKeyViaMemoryCenter.mockResolvedValue({
      created: false,
      apiKey: 'site-sk-plain',
      tokenId: 'tk_site',
      models: ['gpt-4o'],
      status: 'ENABLE',
      spend: 0,
      maxBudget: 100,
      tenantCode: 'C001',
    });

    const sk = await strategy.getUserSk(siteUser, false);

    expect(sk).toBe('site-sk-plain');
    expect(mocks.storeApiKey).toHaveBeenCalledWith(
      'sto-site-sk-v2:C001:site001',
      'site-sk-plain',
    );
  });

  it('getUserSk returns cached plaintext without calling ensure', async () => {
    mocks.getApiKey.mockImplementation(async (key: string) => {
      if (key === 'sto-site-sk-v2:C001:site001') return 'cached-site-sk';
      return null;
    });

    const sk = await strategy.getUserSk(siteUser, false);

    expect(sk).toBe('cached-site-sk');
    expect(mocks.ensureSiteKeyViaMemoryCenter).not.toHaveBeenCalled();
  });

  it('clearCache removes v2 and legacy cache keys', async () => {
    await strategy.clearCache(siteUser);

    expect(mocks.deleteApiKey).toHaveBeenCalledWith('sto-site-sk');
    expect(mocks.deleteApiKey).toHaveBeenCalledWith('sto-site-sk-v2:C001:site001');
    expect(mocks.deleteApiKey).toHaveBeenCalledWith('sto-site-sk:C001:site001');
  });

  it('getDecryptKey is no longer supported on client', async () => {
    await expect(strategy.getDecryptKey()).rejects.toThrow('memory-center');
  });

  it('formatInferenceApiKey returns plain sk unchanged', async () => {
    await expect(strategy.formatInferenceApiKey(siteUser, 'site-sk-plain')).resolves.toBe(
      'site-sk-plain',
    );
  });

  it('getInferenceHeaders returns md5 secret for user code', async () => {
    const expectedSecret = crypto.createHash('md5').update(siteUser.code).digest('hex');
    await expect(strategy.getInferenceHeaders(siteUser)).resolves.toEqual({
      secret: expectedSecret,
    });
  });

  it('getSupplierDomain returns fallback llmgatewayleague prod domain', async () => {
    const domain = await strategy.getSupplierDomain();
    expect(domain).toBe('https://devops-llmgatewayleague.sto.cn');
  });

  it('getSupplierDomain returns test league portal for local SSO environment', async () => {
    const { getSsoEnvironment } = await import('@electron/utils/auth-store');
    vi.mocked(getSsoEnvironment).mockResolvedValueOnce('local');

    const domain = await strategy.getSupplierDomain();
    expect(domain).toBe('https://devops-llmgatewayleague-test.sto.cn');
  });

  it('getSupplierDomain loads Apollo config when cache is empty', async () => {
    mocks.hasSiteInferencePortalDomainCached.mockReturnValueOnce(false);

    await strategy.getSupplierDomain();

    expect(mocks.loadSiteInferencePortalDomain).toHaveBeenCalled();
  });
});
