import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveSclawBrowserUrl } from '@/lib/open-sclaw-browser';

vi.mock('@/lib/workflow-api', () => ({
  getWorkflowStoToken: vi.fn(),
}));

vi.mock('@/lib/sto-policy-web-url', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sto-policy-web-url')>();
  return {
    ...actual,
    injectStoSsoWebAutoLogin: vi.fn(actual.injectStoSsoWebAutoLogin),
  };
});

import { getWorkflowStoToken } from '@/lib/workflow-api';
import { injectStoSsoWebAutoLogin } from '@/lib/sto-policy-web-url';

const mockedGetWorkflowStoToken = vi.mocked(getWorkflowStoToken);
const mockedInjectStoSsoWebAutoLogin = vi.mocked(injectStoSsoWebAutoLogin);

describe('resolveSclawBrowserUrl', () => {
  beforeEach(() => {
    mockedGetWorkflowStoToken.mockReset();
  });

  it('replaces useStoToken=1 with stotoken when local token exists', () => {
    mockedGetWorkflowStoToken.mockReturnValue('tok-local-abc');
    expect(resolveSclawBrowserUrl('https://example.com/app?useStoToken=1&foo=bar')).toBe(
      'https://example.com/app?foo=bar&stotoken=tok-local-abc',
    );
  });

  it('removes useStoToken=1 when no local token is available', () => {
    mockedGetWorkflowStoToken.mockReturnValue(undefined);
    expect(resolveSclawBrowserUrl('https://example.com/app?useStoToken=1')).toBe(
      'https://example.com/app',
    );
  });

  it('uses custom param name when useStoToken is not 1', () => {
    mockedGetWorkflowStoToken.mockReturnValue('tok-local-abc');
    expect(
      resolveSclawBrowserUrl('https://example.com/app?foo=bar&useStoToken=stoTokenxxx'),
    ).toBe('https://example.com/app?foo=bar&stoTokenxxx=tok-local-abc');
  });

  it('leaves url unchanged when useStoToken is absent', () => {
    mockedGetWorkflowStoToken.mockReturnValue('tok-local-abc');
    const url = 'https://example.com/app?stotoken=keep';
    expect(resolveSclawBrowserUrl(url)).toBe(url);
  });

  it('supports relative urls with useStoToken=1', () => {
    mockedGetWorkflowStoToken.mockReturnValue('tok-relative');
    expect(resolveSclawBrowserUrl('customer-quote.html?useStoToken=1')).toBe(
      'customer-quote.html?stotoken=tok-relative',
    );
  });

  it('supports relative urls with custom useStoToken param name', () => {
    mockedGetWorkflowStoToken.mockReturnValue('tok-relative');
    expect(resolveSclawBrowserUrl('customer-quote.html?a=1&useStoToken=myToken')).toBe(
      'customer-quote.html?a=1&myToken=tok-relative',
    );
  });

  it('rewrites sto-policy sso entry with autoLogin token injection', () => {
    mockedGetWorkflowStoToken.mockReturnValue('tok-policy');
    const ssoUrl =
      'https://page.sto.cn/sto-base-service/sto-sso-web/#/main?autoLogin=false&systemCode=sto-policy&returnUrl=/';
    resolveSclawBrowserUrl(ssoUrl);
    expect(mockedInjectStoSsoWebAutoLogin).toHaveBeenCalledWith(ssoUrl, 'tok-policy');
  });

  it('replaces useStoToken=1 on policy host the same as any other host', () => {
    mockedGetWorkflowStoToken.mockReturnValue('tok-policy');
    expect(resolveSclawBrowserUrl('https://zc.sto.cn/?useStoToken=1')).toBe(
      'https://zc.sto.cn/?stotoken=tok-policy',
    );
  });
});
