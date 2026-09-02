import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPublishedSiteSsoAuth } from '../src/site-sso';
import type { StoSsoAuthConfig } from '../src/types';
import { TestBrowserPlatform } from './test-browser';

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jwtWithExpiration(exp: number): string {
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  return `header.${payload}.signature`;
}

describe('published Site SSO', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses an existing cookie without network or redirect', async () => {
    const platform = new TestBrowserPlatform();
    platform.cookie = 'stoToken=token-existing';
    const fetcher = vi.fn<typeof fetch>();
    const auth = createPublishedSiteSsoAuth({ config, platform, fetch: fetcher });

    await auth.bootstrap();

    expect(auth.getToken()).toBe('token-existing');
    expect(fetcher).not.toHaveBeenCalled();
    expect(platform.redirects).toEqual([]);
  });

  it('clears an expired JWT cookie and starts a fresh login', async () => {
    const platform = new TestBrowserPlatform();
    platform.cookie = `stoToken=${jwtWithExpiration(1)}`;
    const auth = createPublishedSiteSsoAuth({ config, platform, fetch: vi.fn<typeof fetch>() });

    await expect(auth.bootstrap()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });

    expect(platform.cookie).toBe('');
    expect(auth.getToken()).toBeNull();
    expect(platform.redirects).toHaveLength(1);
  });

  it('stops returning a JWT that expires while the app is running', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T00:00:00.000Z'));
    const platform = new TestBrowserPlatform();
    platform.cookie = `stoToken=${jwtWithExpiration(1_788_134_401)}`;
    const auth = createPublishedSiteSsoAuth({ config, platform, fetch: vi.fn<typeof fetch>() });
    await auth.bootstrap();

    vi.advanceTimersByTime(1_000);

    expect(auth.getToken()).toBeNull();
    expect(platform.cookie).toBe('');
  });

  it('exchanges callback code once, persists identity, and preserves business URL state', async () => {
    const platform = new TestBrowserPlatform(
      'https://page.sto.cn/?filter=active&code=abc#/reports',
    );
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      success: true,
      data: {
        userLogOnResult: {
          stoToken: 'token-a',
          userInfo: { Id: 'u-1', RealName: '测试用户' },
        },
      },
    }));
    const auth = createPublishedSiteSsoAuth({ config, platform, fetch: fetcher });

    await Promise.all([auth.bootstrap(), auth.bootstrap()]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      'https://baseinfo-usercenterapi-test.sto.cn/sso/login/callback?code=abc',
      {
        method: 'GET',
        credentials: 'omit',
        headers: { Accept: 'application/json' },
      },
    );
    expect(auth.getToken()).toBe('token-a');
    expect(auth.getUser()).toMatchObject({ userId: 'u-1', userName: '测试用户' });
    expect(platform.replacedUrls).toEqual(['/?filter=active#/reports']);
  });

  it('fails safely when a successful response has no Token', async () => {
    const platform = new TestBrowserPlatform('https://page.sto.cn/?code=secret-code');
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => (
      jsonResponse({ success: true, data: {} })
    ));
    const auth = createPublishedSiteSsoAuth({
      config,
      platform,
      fetch: fetcher,
    });

    await expect(auth.bootstrap()).rejects.toMatchObject({ code: 'SSO_EXCHANGE_FAILED' });
    await expect(auth.bootstrap()).rejects.toMatchObject({ code: 'SSO_EXCHANGE_FAILED' });
    expect(JSON.stringify(await auth.bootstrap().catch((error) => error))).not.toContain('secret-code');
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect([...platform.session.values()].join(' ')).not.toContain('secret-code');
  });

  it('keeps the authenticated session when optional user storage is unavailable', async () => {
    const platform = new TestBrowserPlatform('https://page.sto.cn/?code=abc');
    platform.setLocalStorage = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    const auth = createPublishedSiteSsoAuth({
      config,
      platform,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        success: true,
        data: { stoToken: 'token-a', userInfo: { Id: 'u-1' } },
      })),
    });

    await auth.bootstrap();

    expect(auth.getToken()).toBe('token-a');
    expect(platform.cookie).toContain('stoToken=token-a');
    expect(platform.replacedUrls).toEqual(['/']);
  });

  it('falls back to a same-origin navigation when callback URL replacement is blocked', async () => {
    const platform = new TestBrowserPlatform('https://page.sto.cn/app?code=abc#/home');
    platform.replaceUrl = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    const auth = createPublishedSiteSsoAuth({
      config,
      platform,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        success: true,
        data: { stoToken: 'token-a' },
      })),
    });

    await expect(auth.bootstrap()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(platform.redirects).toEqual(['/app#/home']);
    expect(platform.redirects.join(' ')).not.toContain('abc');
  });

  it('normalizes required cookie and session storage failures', async () => {
    const cookiePlatform = new TestBrowserPlatform('https://page.sto.cn/?code=abc');
    cookiePlatform.setCookie = () => {
      throw new DOMException('raw-cookie-error', 'SecurityError');
    };
    const cookieAuth = createPublishedSiteSsoAuth({
      config,
      platform: cookiePlatform,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        success: true,
        data: { stoToken: 'token-a' },
      })),
    });
    await expect(cookieAuth.bootstrap()).rejects.toMatchObject({ code: 'SSO_STORAGE_FAILED' });

    const sessionPlatform = new TestBrowserPlatform('https://page.sto.cn/?code=abc');
    sessionPlatform.getSessionStorage = () => {
      throw new DOMException('raw-session-error', 'SecurityError');
    };
    const sessionAuth = createPublishedSiteSsoAuth({
      config,
      platform: sessionPlatform,
      fetch: vi.fn<typeof fetch>(),
    });
    await expect(sessionAuth.bootstrap()).rejects.toMatchObject({ code: 'SSO_STORAGE_FAILED' });
  });

  it('drops an untrusted trace id from public errors', async () => {
    const platform = new TestBrowserPlatform('https://page.sto.cn/?code=abc');
    const auth = createPublishedSiteSsoAuth({
      config,
      platform,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', {
        status: 500,
        headers: { 'x-trace-id': 'token-a contains spaces' },
      })),
    });

    const error = await auth.bootstrap().catch((caught) => caught);
    expect(error).toMatchObject({ code: 'SSO_EXCHANGE_FAILED' });
    expect(JSON.stringify(error)).not.toContain('token-a');
    expect(error.traceId).toBeUndefined();
  });

  it('redirects only once when there is no session', async () => {
    const platform = new TestBrowserPlatform('https://page.sto.cn/app?x=1#/home');
    const auth = createPublishedSiteSsoAuth({ config, platform, fetch: vi.fn<typeof fetch>() });

    await expect(auth.bootstrap()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    await expect(auth.bootstrap()).rejects.toMatchObject({ code: 'SSO_REDIRECT_LOOP' });
    expect(platform.redirects).toHaveLength(1);
  });

  it('allows one unauthorized recovery and stops a redirect loop', async () => {
    const platform = new TestBrowserPlatform();
    platform.cookie = 'stoToken=token-existing';
    const auth = createPublishedSiteSsoAuth({ config, platform, fetch: vi.fn<typeof fetch>() });
    await auth.bootstrap();

    await expect(auth.handleUnauthorized()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    await expect(auth.handleUnauthorized()).rejects.toMatchObject({ code: 'SSO_REDIRECT_LOOP' });
    expect(platform.redirects).toHaveLength(1);
  });
});
