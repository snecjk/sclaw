import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildStoPolicyEmbedUrl,
  buildStoPolicySsoCallbackUrl,
  buildStoPolicyTargetUrl,
  buildStoPolicyTokenLandingUrl,
  injectStoSsoWebAutoLogin,
  isStoPolicyHostUrl,
  isStoPolicyWebAuthedInSession,
  markStoPolicyWebAuthedInSession,
  parseStoSsoWebUrl,
} from '@/lib/sto-policy-web-url';

vi.mock('../../shared/env-config', () => ({
  getStoPolicyReportApiHost: () => 'zc.sto.cn',
}));

describe('sto-policy-web-url', () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it('parses page.sto.cn sto-sso-web hash params', () => {
    expect(
      parseStoSsoWebUrl(
        'https://page.sto.cn/sto-base-service/sto-sso-web/#/main?autoLogin=false&systemCode=sto-policy&returnUrl=/',
      ),
    ).toEqual({
      systemCode: 'sto-policy',
      returnUrl: '/',
    });
  });

  it('builds policy callback url with redirect', () => {
    expect(buildStoPolicySsoCallbackUrl('tok-policy', '/')).toBe(
      'https://zc.sto.cn/sso/login/callback?stoToken=tok-policy&redirect=%2F',
    );
  });

  it('builds policy target url', () => {
    expect(buildStoPolicyTargetUrl('/')).toBe('https://zc.sto.cn/');
  });

  it('uses stotoken landing on first embed', () => {
    expect(buildStoPolicyEmbedUrl('/', 'tok-policy')).toBe(
      'https://zc.sto.cn/?stotoken=tok-policy',
    );
  });

  it('builds policy token landing url', () => {
    expect(buildStoPolicyTokenLandingUrl('tok-policy', '/')).toBe(
      'https://zc.sto.cn/?stotoken=tok-policy',
    );
  });

  it('injects autoLogin token into page.sto.cn sso url', () => {
    const injected = injectStoSsoWebAutoLogin(
      'https://page.sto.cn/sto-base-service/sto-sso-web/#/main?autoLogin=false&systemCode=ui',
      'tok-ui',
    );
    expect(injected).toContain('autoLogin=true');
    expect(injected).toContain('stoToken=tok-ui');
    expect(injected).toContain('ssoToken=tok-ui');
  });

  it('uses callback on first designer embed and direct url after session auth', () => {
    expect(buildStoPolicyEmbedUrl('/', 'tok-policy')).toBe('https://zc.sto.cn/?stotoken=tok-policy');

    markStoPolicyWebAuthedInSession();
    expect(isStoPolicyWebAuthedInSession()).toBe(true);
    expect(buildStoPolicyEmbedUrl('/', 'tok-policy')).toBe('https://zc.sto.cn/');
  });

  it('detects policy hosts', () => {
    expect(isStoPolicyHostUrl('https://zc.sto.cn/')).toBe(true);
    expect(isStoPolicyHostUrl('https://page.sto.cn/')).toBe(false);
  });
});
