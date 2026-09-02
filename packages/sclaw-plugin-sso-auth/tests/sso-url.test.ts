import { describe, expect, it } from 'vitest';
import {
  buildSsoCallbackExchangeUrl,
  buildSsoLoginUrl,
  readCallbackCode,
  stripAuthParamsFromUrl,
} from '../src/sso-url';
import type { StoSsoAuthConfig } from '../src/types';

const config: StoSsoAuthConfig = {
  protocolVersion: 'sto-sso-auth/v1',
  applicationId: 'app-1001',
  pageType: 'site',
  runtimeMode: 'published',
  deployEnv: 'daily',
  sso: {
    environment: 'daily',
    systemCode: 'STO_CLAW_APP',
    loginOrigin: 'https://baseinfo-usercenterserviceapi-hq-test.sto.cn',
    apiOrigin: 'https://baseinfo-usercenterapi-test.sto.cn',
  },
};

describe('SSO URL contract', () => {
  it('builds the fixed callback endpoint from the selected environment', () => {
    expect(buildSsoCallbackExchangeUrl(config, 'a+b/c')).toBe(
      'https://baseinfo-usercenterapi-test.sto.cn/sso/login/callback?code=a%2Bb%2Fc',
    );
  });

  it('builds a login URL with the complete business return URL and code placeholder', () => {
    const login = new URL(buildSsoLoginUrl(
      config,
      'https://page.sto.cn/report?filter=active#/detail',
    ));

    expect(`${login.origin}${login.pathname}`).toBe(
      'https://baseinfo-usercenterserviceapi-hq-test.sto.cn/Authenticate/Login',
    );
    expect(login.searchParams.get('autoLogin')).toBe('false');
    expect(login.searchParams.get('systemCode')).toBe('STO_CLAW_APP');
    expect(login.searchParams.get('returnUrl')).toBe(
      'https://page.sto.cn/report?filter=active&code=%7B0%7D#/detail',
    );
  });

  it('reads either callback code and removes only authentication query keys', () => {
    expect(readCallbackCode('https://page.sto.cn/?authorizationCode=abc&x=1')).toBe('abc');
    expect(stripAuthParamsFromUrl(
      'https://page.sto.cn/?filter=active&code=abc&authorizationCode=def#/reports',
    )).toBe('/?filter=active#/reports');
  });
});
