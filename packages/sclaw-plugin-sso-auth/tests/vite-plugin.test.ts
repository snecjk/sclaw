import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ssoAuthVite } from '../src/vite/plugin';

const ENV_KEYS = [
  'STO_SSO_AUTH_SESSION',
  'STO_SSO_AUTH_WORKSPACE_ID',
  'STO_SSO_AUTH_APPLICATION_ID',
  'STO_SSO_AUTH_PAGE_TYPE',
  'STO_SSO_AUTH_DEPLOY_ENV',
  'STO_SSO_AUTH_HOST_API',
] as const;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function setValidEnvironment(): void {
  vi.stubEnv('STO_SSO_AUTH_SESSION', 'session-secret');
  vi.stubEnv('STO_SSO_AUTH_WORKSPACE_ID', 'ws-1');
  vi.stubEnv('STO_SSO_AUTH_APPLICATION_ID', 'app-1');
  vi.stubEnv('STO_SSO_AUTH_PAGE_TYPE', 'site');
  vi.stubEnv('STO_SSO_AUTH_DEPLOY_ENV', 'daily');
  vi.stubEnv('STO_SSO_AUTH_HOST_API', 'http://127.0.0.1:3210');
}

describe('ssoAuthVite', () => {
  it('is excluded from production builds', () => {
    expect(ssoAuthVite()).toMatchObject({ apply: 'serve' });
  });

  it('fails startup when server-only identity values are missing', () => {
    for (const key of ENV_KEYS) vi.stubEnv(key, '');
    const plugin = ssoAuthVite();
    expect(() => (plugin.configResolved as (config: unknown) => void)({}))
      .toThrowError(expect.objectContaining({ code: 'LOCAL_AUTH_UNAVAILABLE' }));
  });

  it('injects only public local config into HTML', () => {
    setValidEnvironment();
    const plugin = ssoAuthVite();
    (plugin.configResolved as (config: unknown) => void)({});
    const transformed = (plugin.transformIndexHtml as () => unknown)();
    const serialized = JSON.stringify(transformed);

    expect(serialized).toContain('sto-sso-auth/v1');
    expect(serialized).toContain('app-1');
    expect(serialized).not.toContain('session-secret');
    expect(serialized).not.toContain('127.0.0.1:3210');
  });

  it('forwards only the server-owned Workspace and Secret', async () => {
    setValidEnvironment();
    const hostFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      token: 'token-a',
      user: { userId: 'u-1', userName: '测试用户' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', hostFetch);
    const plugin = ssoAuthVite();
    (plugin.configResolved as (config: unknown) => void)({});

    let middleware: ((req: IncomingMessage, res: ServerResponse, next: () => void) => void) | undefined;
    (plugin.configureServer as (server: unknown) => void)({
      middlewares: {
        use(handler: typeof middleware) {
          middleware = handler;
        },
      },
    });

    let body = '';
    const response = {
      statusCode: 0,
      setHeader: vi.fn(),
      end(value: string) {
        body = value;
      },
    } as unknown as ServerResponse;
    middleware?.({
      method: 'GET',
      url: '/__sto/sso-auth/bootstrap',
      headers: {
        'x-sto-sso-auth-workspace': 'browser-override',
        'x-sto-sso-auth-session': 'browser-secret',
      },
    } as unknown as IncomingMessage, response, vi.fn());
    await vi.waitFor(() => expect(body).not.toBe(''));

    expect(hostFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3210/api/app-dev/sso-auth/bootstrap',
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'x-sto-sso-auth-workspace': 'ws-1',
          'x-sto-sso-auth-session': 'session-secret',
        },
      },
    );
    expect(JSON.parse(body)).toEqual({
      success: true,
      token: 'token-a',
      user: { userId: 'u-1', userName: '测试用户' },
    });
  });
});
