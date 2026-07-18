import { beforeEach, describe, expect, it, vi } from 'vitest';

const getProviderAccountMock = vi.hoisted(() => vi.fn());

vi.mock('@electron/services/providers/provider-store', () => ({
  getProviderAccount: (...args: unknown[]) => getProviderAccountMock(...args),
}));

import { getLoginSyncedStoModel } from '@electron/services/providers/login-synced-sto-model';

describe('getLoginSyncedStoModel', () => {
  beforeEach(() => vi.resetAllMocks());

  it('uses the model selected by post-login STO synchronization', async () => {
    getProviderAccountMock.mockResolvedValue({
      model: 'login-selected-model',
      metadata: { customModels: ['catalog-first-model'] },
    });

    await expect(getLoginSyncedStoModel()).resolves.toBe('login-selected-model');
    expect(getProviderAccountMock).toHaveBeenCalledWith('sto');
  });

  it('falls back to the login-synced catalog when no selection exists', async () => {
    getProviderAccountMock.mockResolvedValue({
      metadata: { customModels: ['', 'catalog-first-model'] },
    });

    await expect(getLoginSyncedStoModel()).resolves.toBe('catalog-first-model');
  });
});
