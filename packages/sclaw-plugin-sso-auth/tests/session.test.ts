import { describe, expect, it } from 'vitest';
import {
  clearStoredSession,
  persistSession,
  readTokenCookie,
  TOKEN_COOKIE_KEY,
  USER_STORAGE_KEY,
} from '../src/session';
import { TestBrowserPlatform } from './test-browser';

describe('published Site session', () => {
  it('writes a host-only secure Token cookie and stores user data without the Token', () => {
    const platform = new TestBrowserPlatform();

    persistSession(platform, {
      token: 'token-a',
      user: { userId: 'u-1', userName: '测试用户', stoToken: 'must-not-persist' },
    });

    expect(platform.cookieWrites[0]).toBe(
      'stoToken=token-a; Path=/; Max-Age=604800; SameSite=Lax; Secure',
    );
    expect(platform.cookieWrites[0]).not.toContain('Domain=');
    expect(readTokenCookie(platform.cookie)).toBe('token-a');
    expect(platform.local.get(USER_STORAGE_KEY)).toBe(
      JSON.stringify({ userId: 'u-1', userName: '测试用户' }),
    );

    clearStoredSession(platform);
    expect(platform.cookieWrites[platform.cookieWrites.length - 1]).toBe(
      `${TOKEN_COOKIE_KEY}=; Path=/; Max-Age=0; SameSite=Lax; Secure`,
    );
    expect(platform.local.has(USER_STORAGE_KEY)).toBe(false);
  });
});
