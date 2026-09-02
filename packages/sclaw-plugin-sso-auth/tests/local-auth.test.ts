import { describe, expect, it, vi } from 'vitest';
import { createLocalSsoAuth } from '../src/local-auth';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('local SClaw identity provider', () => {
  it('loads the current identity once and keeps it only in memory', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      success: true,
      token: 'token-local',
      user: { userId: 'u-1', userName: '本地用户' },
    }));
    const auth = createLocalSsoAuth({ fetch: fetcher });

    await Promise.all([auth.bootstrap(), auth.bootstrap()]);

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith('/__sto/sso-auth/bootstrap', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    expect(auth.getToken()).toBe('token-local');
    expect(auth.getUser()).toEqual({ userId: 'u-1', userName: '本地用户' });
  });

  it('normalizes missing and unauthorized identities without echoing secrets', async () => {
    const auth = createLocalSsoAuth({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        success: false,
        error: 'AUTH_REQUIRED',
        secret: 'must-not-echo',
      }, 401)),
    });

    const error = await auth.bootstrap().catch((value) => value);
    expect(error).toMatchObject({ code: 'AUTH_REQUIRED', httpStatus: 401 });
    expect(JSON.stringify(error)).not.toContain('must-not-echo');
  });
});
