import { StoSsoAuthError } from './errors';
import type { SsoBrowserPlatform } from './browser-platform';
import type { StoSsoUser } from './types';

export const TOKEN_COOKIE_KEY = 'stoToken';
export const USER_STORAGE_KEY = 'sto.sso-auth.user.v1';
export const REDIRECT_GUARD_KEY = 'sto.sso-auth.redirect.v1';
export const UNAUTHORIZED_GUARD_KEY = 'sto.sso-auth.unauthorized.v1';
export const CALLBACK_CODE_CLAIM_KEY = 'sto.sso-auth.callback-code.v1';
const TOKEN_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export interface StoredSsoSession {
  token: string;
  user: StoSsoUser;
}

function secureSuffix(platform: SsoBrowserPlatform): string {
  return platform.protocol === 'https:' ? '; Secure' : '';
}

function sanitizeUser(user: StoSsoUser): StoSsoUser {
  return Object.fromEntries(
    Object.entries(user).filter(([key]) => !['stotoken', 'token'].includes(key.toLowerCase())),
  );
}

export function readTokenCookie(cookie: string): string | null {
  const match = cookie.match(/(?:^|;\s*)stoToken=([^;]*)/i);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]).trim() || null;
  } catch {
    return null;
  }
}

export function readStoredUser(platform: SsoBrowserPlatform): StoSsoUser | null {
  try {
    const raw = platform.getLocalStorage(USER_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return sanitizeUser(value as StoSsoUser);
  } catch {
    return null;
  }
}

export function persistSession(
  platform: SsoBrowserPlatform,
  session: StoredSsoSession,
): void {
  const sanitizedUser = JSON.stringify(sanitizeUser(session.user));
  try {
    platform.setLocalStorage(USER_STORAGE_KEY, sanitizedUser);
  } catch {
    // User profile caching is optional; the Token Cookie remains the source of truth.
  }

  try {
    platform.setCookie(
      `${TOKEN_COOKIE_KEY}=${encodeURIComponent(session.token)}; Path=/; Max-Age=${TOKEN_MAX_AGE_SECONDS}; SameSite=Lax${secureSuffix(platform)}`,
    );
    if (readTokenCookie(platform.cookie) !== session.token) {
      throw new Error('Token Cookie was not persisted');
    }
  } catch {
    try {
      platform.removeLocalStorage(USER_STORAGE_KEY);
    } catch {
      // Best-effort rollback of non-sensitive display data.
    }
    throw new StoSsoAuthError('SSO_STORAGE_FAILED', '无法保存 SSO 会话');
  }
}

export function clearStoredSession(platform: SsoBrowserPlatform): void {
  try {
    platform.setCookie(
      `${TOKEN_COOKIE_KEY}=; Path=/; Max-Age=0; SameSite=Lax${secureSuffix(platform)}`,
    );
  } catch {
    throw new StoSsoAuthError('SSO_STORAGE_FAILED', '无法清理 SSO 会话');
  }
  try {
    platform.removeLocalStorage(USER_STORAGE_KEY);
  } catch {
    // The cached display profile is non-sensitive and can expire independently.
  }
}
