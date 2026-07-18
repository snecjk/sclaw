import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: class {}, session: { fromPartition: vi.fn() } }));
vi.mock('@electron/utils/sso-service', () => ({
  buildLoginUrl: vi.fn(), exchangeCodeForUser: vi.fn(), getBaseUrl: vi.fn(),
}));

describe('SSO callback claim guard', () => {
  it('allows exactly one callback claimant', async () => {
    const { createSsoCallbackClaimGuard } = await import('@electron/utils/sso-login');
    const claim = createSsoCallbackClaimGuard();
    expect([claim(), claim(), claim()]).toEqual([true, false, false]);
  });
});
