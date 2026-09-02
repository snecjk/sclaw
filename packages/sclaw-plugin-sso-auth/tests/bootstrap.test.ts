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

const localConfig = {
  protocolVersion: 'sto-sso-auth/v1',
  applicationId: 'app-1001',
  pageType: 'assets',
  runtimeMode: 'local',
  deployEnv: 'daily',
} as const;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

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

  it('calls the default global fetch with the global receiver', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = function receiverSensitiveFetch(this: unknown) {
      if (this !== globalThis) {
        throw new TypeError('Illegal invocation');
      }
      return Promise.resolve(jsonResponse({
        success: true,
        token: 'token-local',
        user: { userId: 'u-1', userName: '本地用户' },
      }));
    } as unknown as typeof fetch;

    try {
      vi.resetModules();
      const { bootstrapSsoAuth: bootstrapWithDefaultFetch } = await import('../src/index');

      const auth = await bootstrapWithDefaultFetch({ config: localConfig });

      expect(auth.getToken()).toBe('token-local');
      expect(auth.getUser()).toEqual({ userId: 'u-1', userName: '本地用户' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
