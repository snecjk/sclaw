/**
 * Site auth cookie helpers (sto-policy / Teambition).
 * Validate cookie expirationDate and JWT exp when present.
 */

export const STO_POLICY_AUTH_COOKIE_NAMES = ['stoToken', 'Authorization'] as const;
export const TEAMBITION_AUTH_COOKIE_NAMES = ['TEAMBITION_SESSIONID'] as const;

export type StoPolicyAuthCookieName = (typeof STO_POLICY_AUTH_COOKIE_NAMES)[number];
export type TeambitionAuthCookieName = (typeof TEAMBITION_AUTH_COOKIE_NAMES)[number];

/** Cookie-shaped input (Electron Cookie or plain object). */
export interface StoPolicyAuthCookieLike {
  name?: string | null;
  value?: string | null;
  /** Electron Cookie.expirationDate — seconds since epoch */
  expirationDate?: number | null;
}

export type AuthCookieLike = StoPolicyAuthCookieLike;

export function isLikelyJwt(token: string): boolean {
  const parts = token.split('.');
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

/** Decode JWT payload without verifying signature; returns null when not a JWT. */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  if (!isLikelyJwt(token)) return null;
  try {
    const payloadPart = token.split('.')[1]!;
    const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const json = typeof atob === 'function'
      ? atob(padded)
      : Buffer.from(padded, 'base64').toString('utf8');
    const payload = JSON.parse(json) as unknown;
    return payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** True when JWT has exp and it is already past (nowSec defaults to now). */
export function isJwtExpired(token: string, nowSec: number = Math.floor(Date.now() / 1000)): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload) return false;
  const exp = payload.exp;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return false;
  return exp <= nowSec;
}

/**
 * Whether a cookie value can be treated as an active auth token.
 * - empty → invalid
 * - cookie expirationDate in the past → invalid
 * - JWT with exp in the past → invalid
 * - otherwise non-empty → valid
 */
export function isAuthCookieValid(
  cookie: AuthCookieLike,
  nowMs: number = Date.now(),
): boolean {
  const value = cookie.value?.trim() || '';
  if (!value) return false;

  if (typeof cookie.expirationDate === 'number' && Number.isFinite(cookie.expirationDate)) {
    if (cookie.expirationDate * 1000 <= nowMs) return false;
  }

  if (isJwtExpired(value, Math.floor(nowMs / 1000))) return false;
  return true;
}

/** @deprecated Prefer isAuthCookieValid */
export const isStoPolicyAuthCookieValid = isAuthCookieValid;

export function pickValidAuthCookie(
  cookies: AuthCookieLike[],
  preferredNames: readonly string[],
  nowMs: number = Date.now(),
): AuthCookieLike | null {
  for (const name of preferredNames) {
    const match = cookies.find(
      (cookie) => cookie.name === name && isAuthCookieValid(cookie, nowMs),
    );
    if (match) return match;
  }
  return null;
}

/** Prefer stoToken over Authorization among candidate cookies. */
export function pickValidStoPolicyAuthCookie(
  cookies: AuthCookieLike[],
  nowMs: number = Date.now(),
): AuthCookieLike | null {
  return pickValidAuthCookie(cookies, STO_POLICY_AUTH_COOKIE_NAMES, nowMs);
}

export function hasValidStoPolicyAuthCookie(
  cookies: AuthCookieLike[],
  nowMs: number = Date.now(),
): boolean {
  return pickValidStoPolicyAuthCookie(cookies, nowMs) !== null;
}

export function pickValidTeambitionAuthCookie(
  cookies: AuthCookieLike[],
  nowMs: number = Date.now(),
): AuthCookieLike | null {
  return pickValidAuthCookie(cookies, TEAMBITION_AUTH_COOKIE_NAMES, nowMs);
}

export function hasValidTeambitionAuthCookie(
  cookies: AuthCookieLike[],
  nowMs: number = Date.now(),
): boolean {
  return pickValidTeambitionAuthCookie(cookies, nowMs) !== null;
}

export function isTeambitionHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return host === 'teambition.com' || host.endsWith('.teambition.com');
}

export function isTeambitionAppUrl(url: string): boolean {
  try {
    return isTeambitionHost(new URL(url).hostname);
  } catch {
    return false;
  }
}
