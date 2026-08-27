import { describe, expect, it, vi } from 'vitest';
import { bootstrapSsoAuth, getSsoAuth } from '../src/index';
import { TestBrowserPlatform } from './test-browser';

const config = {
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

describe('bootstrapSsoAuth', () => {
  it('publishes the singleton only after one successful bootstrap', async () => {
    const platform = new TestBrowserPlatform();
    platform.cookie = 'stoToken=token-a';
    const fetcher = vi.fn<typeof fetch>();

    const [first, second] = await Promise.all([
      bootstrapSsoAuth({ config, platform, fetch: fetcher }),
      bootstrapSsoAuth({ config, platform, fetch: fetcher }),
    ]);

    expect(first).toBe(second);
    expect(getSsoAuth()).toBe(first);
  });
});
