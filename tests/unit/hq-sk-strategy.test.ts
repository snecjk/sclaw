import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SsoUserInfo } from '@electron/utils/auth-store';

const mocks = vi.hoisted(() => ({
  ensureHqKeyViaMemoryCenter: vi.fn(),
  getAiResourceStoToken: vi.fn(),
  getApiKey: vi.fn(),
  storeApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
}));

vi.mock('@electron/services/sto-hq-memory-api-service', () => ({
  ensureHqKeyViaMemoryCenter: mocks.ensureHqKeyViaMemoryCenter,
  fetchHqTokenQuotaTiersViaMemoryCenter: vi.fn(),
  StoHqMemoryApiError: class extends Error {},
}));

vi.mock('@electron/services/sto-auth-mode', () => ({
  getAiResourceStoToken: mocks.getAiResourceStoToken,
}));

vi.mock('@electron/utils/secure-storage', () => ({
  getApiKey: mocks.getApiKey,
  storeApiKey: mocks.storeApiKey,
  deleteApiKey: mocks.deleteApiKey,
}));

vi.mock('@electron/utils/auth-store', () => ({
  getSsoEnvironment: vi.fn().mockResolvedValue('production'),
}));

import { HqSkStrategy } from '@electron/services/sto-hq-sk-strategy';

const hqUser: SsoUserInfo = {
  id: '1',
  userName: 'hq',
  realName: 'HQ',
  code: 'hq001',
  empCode: 'hq001',
  companyId: 'c1',
  companyCode: 'C001',
  companyName: 'HQ Co',
  departmentId: 'd1',
  departmentCode: 'D001',
  departmentName: 'Dept',
  categoryCode: '总部',
  isAdministrator: false,
  loginMode: 'sso',
  openId: 'oid',
  signature: 'sig',
  authenticatedAt: new Date().toISOString(),
};

describe('HqSkStrategy', () => {
  let strategy: HqSkStrategy;

  beforeEach(() => {
    vi.resetAllMocks();
    strategy = new HqSkStrategy();
    mocks.getAiResourceStoToken.mockResolvedValue('sto-token');
    mocks.getApiKey.mockResolvedValue(null);
    mocks.storeApiKey.mockResolvedValue(undefined);
    mocks.deleteApiKey.mockResolvedValue(undefined);
  });

  it('getUserSk stores and returns plaintext apiKey from memory-center', async () => {
    mocks.ensureHqKeyViaMemoryCenter.mockResolvedValue({
      created: true,
      apiKey: 'sk-plain-from-server',
      tokenId: 'tk_1',
      models: ['gpt-4o'],
      status: 'ENABLE',
      spend: 0,
      maxBudget: 100,
    });

    const sk = await strategy.getUserSk(hqUser, false);

    expect(sk).toBe('sk-plain-from-server');
    expect(mocks.storeApiKey).toHaveBeenCalledWith('sto-sk-v2', 'sk-plain-from-server');
    expect(mocks.ensureHqKeyViaMemoryCenter).toHaveBeenCalled();
  });

  it('getUserSk returns cached plaintext without calling ensure', async () => {
    mocks.getApiKey.mockResolvedValue('cached-plain-sk');

    const sk = await strategy.getUserSk(hqUser, false);

    expect(sk).toBe('cached-plain-sk');
    expect(mocks.ensureHqKeyViaMemoryCenter).not.toHaveBeenCalled();
  });

  it('clearCache removes v2 and legacy cache keys', async () => {
    await strategy.clearCache(hqUser);

    expect(mocks.deleteApiKey).toHaveBeenCalledWith('sto-sk-v2');
    expect(mocks.deleteApiKey).toHaveBeenCalledWith('sto');
  });

  it('getDecryptKey is no longer supported on client', async () => {
    await expect(strategy.getDecryptKey()).rejects.toThrow('memory-center');
  });
});
