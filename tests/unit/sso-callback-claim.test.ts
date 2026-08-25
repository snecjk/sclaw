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

describe('isAbortedNavigationError', () => {
  it('recognizes superseded navigations by code, errno, or message', async () => {
    const { isAbortedNavigationError } = await import('@electron/utils/sso-login');
    expect(isAbortedNavigationError({ code: 'ERR_ABORTED' })).toBe(true);
    expect(isAbortedNavigationError({ errno: -3 })).toBe(true);
    expect(isAbortedNavigationError(
      new Error("ERR_ABORTED (-3) loading 'https://oapi.dingtalk.com/connect/oauth2/sns_authorize?appid=x'"),
    )).toBe(true);
  });

  it('keeps real load failures fatal', async () => {
    const { isAbortedNavigationError } = await import('@electron/utils/sso-login');
    expect(isAbortedNavigationError(new Error('ERR_NAME_NOT_RESOLVED (-105) loading https://x'))).toBe(false);
    expect(isAbortedNavigationError({ code: 'ERR_CONNECTION_TIMED_OUT', errno: -118 })).toBe(false);
    expect(isAbortedNavigationError(null)).toBe(false);
    expect(isAbortedNavigationError('ERR_ABORTED')).toBe(false);
  });
});
