import { afterEach, describe, expect, it, vi } from 'vitest';
import { readStoSsoAuthConfig, resolveStoSsoDeployEnv } from '../src/config';

const publishedSite = {
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
} as const;

describe('readStoSsoAuthConfig', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates published Site config from the browser hostname when global config is absent', () => {
    vi.stubGlobal('window', {
      location: { hostname: 'page-test.sto.cn' },
    });

    expect(readStoSsoAuthConfig()).toMatchObject({
      protocolVersion: 'sto-sso-auth/v1',
      pageType: 'site',
      runtimeMode: 'published',
      deployEnv: 'daily',
      sso: publishedSite.sso,
    });
  });

  it('keeps missing configuration as an error on local preview hosts', () => {
    vi.stubGlobal('window', {
      location: { hostname: '127.0.0.1' },
    });

    expect(() => readStoSsoAuthConfig()).toThrowError(expect.objectContaining({
      code: 'SSO_AUTH_CONFIG_MISSING',
    }));
  });

  it('infers SSO environment from the published hostname', () => {
    expect(resolveStoSsoDeployEnv('page-test.sto.cn')).toBe('daily');
    expect(resolveStoSsoDeployEnv('page-pre.sto.cn')).toBe('stage');
    expect(resolveStoSsoDeployEnv('page.sto.cn')).toBe('online');
  });

  it('allows published Site config without application metadata', () => {
    expect(readStoSsoAuthConfig({
      protocolVersion: 'sto-sso-auth/v1',
      runtimeMode: 'published',
      deployEnv: 'daily',
    })).toMatchObject({ pageType: 'site', deployEnv: 'daily', sso: publishedSite.sso });
  });
  it('accepts the published Site configuration contract', () => {
    expect(readStoSsoAuthConfig(publishedSite)).toEqual(publishedSite);
  });

  it('accepts Assets applications only for local preview', () => {
    expect(readStoSsoAuthConfig({
      protocolVersion: 'sto-sso-auth/v1',
      applicationId: 'app-1001',
      pageType: 'assets',
      runtimeMode: 'local',
      deployEnv: 'daily',
    })).toMatchObject({ pageType: 'assets', runtimeMode: 'local', deployEnv: 'daily' });

    expect(() => readStoSsoAuthConfig({ ...publishedSite, pageType: 'assets' }))
      .toThrowError(expect.objectContaining({
        code: 'SSO_AUTH_PAGE_TYPE_UNSUPPORTED',
      }));
  });

  it('rejects secret-like unknown configuration fields', () => {
    expect(() => readStoSsoAuthConfig({ ...publishedSite, stoToken: 'secret-a' }))
      .toThrowError(expect.objectContaining({ code: 'SSO_AUTH_CONFIG_INVALID' }));
  });

  it('rejects unapproved HTTPS origins and System Codes', () => {
    expect(() => readStoSsoAuthConfig({
      ...publishedSite,
      sso: { ...publishedSite.sso, apiOrigin: 'https://attacker.example.com' },
    })).toThrowError(expect.objectContaining({ code: 'SSO_AUTH_CONFIG_INVALID' }));
    expect(() => readStoSsoAuthConfig({
      ...publishedSite,
      sso: { ...publishedSite.sso, systemCode: 'ATTACKER_APP' },
    })).toThrowError(expect.objectContaining({ code: 'SSO_AUTH_CONFIG_INVALID' }));
  });

  it.each([
    ['daily', 'daily', 'https://baseinfo-usercenterserviceapi-hq-test.sto.cn', 'https://baseinfo-usercenterapi-test.sto.cn'],
    ['stage', 'pre', 'https://pre-baseinfo-usercenterservice-api-hq.sto.cn', 'https://pre-baseinfo-usercenterapi.sto.cn'],
    ['online', 'prod', 'https://baseinfo-usercenterserviceapi.sto.cn', 'https://baseinfo-usercenterapi.sto.cn'],
  ] as const)('accepts the approved %s environment matrix', (
    deployEnv,
    environment,
    loginOrigin,
    apiOrigin,
  ) => {
    expect(readStoSsoAuthConfig({
      ...publishedSite,
      deployEnv,
      sso: {
        environment,
        systemCode: 'STO_CLAW_APP',
        loginOrigin,
        apiOrigin,
      },
    })).toMatchObject({ deployEnv, sso: { environment, loginOrigin, apiOrigin } });
  });
});
