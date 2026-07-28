import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/workflow-api', () => ({
  getWorkflowStoToken: vi.fn(),
}));

const fetchAppPlazaSkipLoginLinkMock = vi.fn();
const appendSkipLoginReturnUrlMock = vi.fn();

vi.mock('@/lib/app-plaza-api', () => ({
  fetchAppPlazaSkipLoginLink: (...args: unknown[]) => fetchAppPlazaSkipLoginLinkMock(...args),
  appendSkipLoginReturnUrl: (...args: unknown[]) => appendSkipLoginReturnUrlMock(...args),
}));

const openExternalUrlMock = vi.fn();

vi.mock('@/lib/preview-url', () => ({
  openExternalUrl: (...args: unknown[]) => openExternalUrlMock(...args),
}));

const toastErrorMock = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
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
import { useSclawBrowserOverlayStore } from '@/stores/sclaw-browser-overlay';
import {
  openSclawBrowserInSystemBrowser,
  resolveSclawBrowserUrl,
} from '@/lib/open-sclaw-browser';

const mockedGetWorkflowStoToken = vi.mocked(getWorkflowStoToken);
const mockedInjectStoSsoWebAutoLogin = vi.mocked(injectStoSsoWebAutoLogin);

describe('resolveSclawBrowserUrl', () => {
  beforeEach(() => {
    mockedGetWorkflowStoToken.mockReset();
    fetchAppPlazaSkipLoginLinkMock.mockReset();
    appendSkipLoginReturnUrlMock.mockReset();
    openExternalUrlMock.mockReset();
    toastErrorMock.mockReset();
    useSclawBrowserOverlayStore.setState({ session: null });
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

  it('re-exchanges skip-login before opening in system browser', async () => {
    fetchAppPlazaSkipLoginLinkMock.mockResolvedValue(
      'https://sso.example.com/Authenticate/Login?code=abc',
    );
    appendSkipLoginReturnUrlMock.mockReturnValue(
      'https://sso.example.com/Authenticate/Login?code=abc&returnUrl=https%3A%2F%2Ftarget.example.com',
    );
    useSclawBrowserOverlayStore.setState({
      session: {
        appId: 'app-1',
        title: 'App 1',
        url: 'https://sso.example.com/Authenticate/Login?old=1',
        sourceUrl: 'https://target.example.com',
        systemCode: 'JIUTIAN',
      },
    });

    await openSclawBrowserInSystemBrowser();

    expect(fetchAppPlazaSkipLoginLinkMock).toHaveBeenCalledWith('JIUTIAN');
    expect(appendSkipLoginReturnUrlMock).toHaveBeenCalledWith(
      'https://sso.example.com/Authenticate/Login?code=abc',
      'https://target.example.com',
    );
    expect(openExternalUrlMock).toHaveBeenCalledWith(
      'https://sso.example.com/Authenticate/Login?code=abc&returnUrl=https%3A%2F%2Ftarget.example.com',
    );
  });

  it('falls back to current session url when skip-login exchange fails', async () => {
    fetchAppPlazaSkipLoginLinkMock.mockRejectedValue(new Error('换票失败'));
    useSclawBrowserOverlayStore.setState({
      session: {
        appId: 'app-1',
        title: 'App 1',
        url: 'https://sso.example.com/Authenticate/Login?old=1',
        sourceUrl: 'https://target.example.com',
        systemCode: 'JIUTIAN',
      },
    });

    await openSclawBrowserInSystemBrowser();

    expect(toastErrorMock).toHaveBeenCalledWith('换票失败');
    expect(openExternalUrlMock).toHaveBeenCalledWith(
      'https://sso.example.com/Authenticate/Login?old=1',
    );
  });

  it('exchanges skip-login for a specific tab systemCode (e.g. SITE_KEEPER)', async () => {
    fetchAppPlazaSkipLoginLinkMock.mockResolvedValue(
      'https://sso.example.com/Authenticate/Login?code=keeper',
    );
    appendSkipLoginReturnUrlMock.mockReturnValue(
      'https://sso.example.com/Authenticate/Login?code=keeper&returnUrl=https%3A%2F%2Fwangdian.sto.cn',
    );

    const { openSclawBrowserTabInSystemBrowser } = await import('@/lib/open-sclaw-browser');
    await openSclawBrowserTabInSystemBrowser({
      url: 'https://wangdian.sto.cn/home',
      sourceUrl: 'https://wangdian.sto.cn',
      systemCode: 'SITE_KEEPER',
    });

    expect(fetchAppPlazaSkipLoginLinkMock).toHaveBeenCalledWith('SITE_KEEPER');
    expect(openExternalUrlMock).toHaveBeenCalledWith(
      'https://sso.example.com/Authenticate/Login?code=keeper&returnUrl=https%3A%2F%2Fwangdian.sto.cn',
    );
  });

  it('skips skip-login exchange when tab systemCode is empty', async () => {
    const { openSclawBrowserTabInSystemBrowser } = await import('@/lib/open-sclaw-browser');
    await openSclawBrowserTabInSystemBrowser({
      url: 'https://example.com/plain',
      sourceUrl: 'https://example.com/plain',
      systemCode: '',
    });

    expect(fetchAppPlazaSkipLoginLinkMock).not.toHaveBeenCalled();
    expect(openExternalUrlMock).toHaveBeenCalledWith('https://example.com/plain');
  });

  it('skips skip-login exchange when tab systemCode is sto-policy', async () => {
    const { openSclawBrowserTabInSystemBrowser } = await import('@/lib/open-sclaw-browser');
    await openSclawBrowserTabInSystemBrowser({
      url: 'https://zc.sto.cn/',
      sourceUrl: 'https://zc.sto.cn/',
      systemCode: 'sto-policy',
    });

    expect(fetchAppPlazaSkipLoginLinkMock).not.toHaveBeenCalled();
    expect(openExternalUrlMock).toHaveBeenCalledWith('https://zc.sto.cn/');
  });
});
