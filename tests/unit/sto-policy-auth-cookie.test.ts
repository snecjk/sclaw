import { describe, expect, it } from 'vitest';
import {
  decodeJwtPayload,
  hasValidStoPolicyAuthCookie,
  hasValidTeambitionAuthCookie,
  isJwtExpired,
  isStoPolicyAuthCookieValid,
  isTeambitionAppUrl,
  pickValidStoPolicyAuthCookie,
} from '../../shared/sto-policy-auth-cookie';

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

describe('sto-policy-auth-cookie', () => {
  const nowMs = 1_700_000_000_000;
  const nowSec = Math.floor(nowMs / 1000);

  it('decodes jwt payload and detects expiry', () => {
    const token = makeJwt({ exp: nowSec + 60, sub: 'u1' });
    expect(decodeJwtPayload(token)).toEqual({ exp: nowSec + 60, sub: 'u1' });
    expect(isJwtExpired(token, nowSec)).toBe(false);
    expect(isJwtExpired(makeJwt({ exp: nowSec - 1 }), nowSec)).toBe(true);
  });

  it('treats empty cookie as invalid', () => {
    expect(isStoPolicyAuthCookieValid({ name: 'stoToken', value: '  ' }, nowMs)).toBe(false);
  });

  it('rejects cookie past Electron expirationDate', () => {
    expect(
      isStoPolicyAuthCookieValid(
        { name: 'stoToken', value: 'plain-token', expirationDate: nowSec - 10 },
        nowMs,
      ),
    ).toBe(false);
  });

  it('rejects expired jwt even when cookie expirationDate is missing', () => {
    expect(
      isStoPolicyAuthCookieValid(
        { name: 'Authorization', value: makeJwt({ exp: nowSec - 5 }) },
        nowMs,
      ),
    ).toBe(false);
  });

  it('accepts non-expired jwt stoToken', () => {
    expect(
      isStoPolicyAuthCookieValid(
        { name: 'stoToken', value: makeJwt({ exp: nowSec + 120 }) },
        nowMs,
      ),
    ).toBe(true);
  });

  it('prefers stoToken over Authorization', () => {
    const picked = pickValidStoPolicyAuthCookie(
      [
        { name: 'Authorization', value: makeJwt({ exp: nowSec + 120 }) },
        { name: 'stoToken', value: makeJwt({ exp: nowSec + 120 }) },
      ],
      nowMs,
    );
    expect(picked?.name).toBe('stoToken');
  });

  it('falls back to Authorization when stoToken is expired', () => {
    expect(
      hasValidStoPolicyAuthCookie(
        [
          { name: 'stoToken', value: makeJwt({ exp: nowSec - 1 }) },
          { name: 'Authorization', value: makeJwt({ exp: nowSec + 30 }) },
        ],
        nowMs,
      ),
    ).toBe(true);
  });

  it('returns false when both tokens are expired', () => {
    expect(
      hasValidStoPolicyAuthCookie(
        [
          { name: 'stoToken', value: makeJwt({ exp: nowSec - 1 }) },
          { name: 'Authorization', value: makeJwt({ exp: nowSec - 2 }) },
        ],
        nowMs,
      ),
    ).toBe(false);
  });

  it('detects teambition urls and validates TEAMBITION_SESSIONID', () => {
    expect(isTeambitionAppUrl('https://www.teambition.com/project/x')).toBe(true);
    expect(isTeambitionAppUrl('https://zc.sto.cn/')).toBe(false);
    expect(
      hasValidTeambitionAuthCookie(
        [{ name: 'TEAMBITION_SESSIONID', value: 'session-abc', expirationDate: nowSec + 3600 }],
        nowMs,
      ),
    ).toBe(true);
    expect(
      hasValidTeambitionAuthCookie(
        [{ name: 'TEAMBITION_SESSIONID', value: 'session-abc', expirationDate: nowSec - 1 }],
        nowMs,
      ),
    ).toBe(false);
  });
});
