import type { SsoBrowserPlatform } from './browser-platform';
import { StoSsoAuthError } from './errors';
import {
  clearStoredSession,
  CALLBACK_CODE_CLAIM_KEY,
  isTokenExpired,
  persistSession,
  readStoredUser,
  readTokenCookie,
  REDIRECT_GUARD_KEY,
  UNAUTHORIZED_GUARD_KEY,
} from './session';
import {
  buildSsoCallbackExchangeUrl,
  buildSsoLoginUrl,
  readCallbackCode,
  stripAuthParamsFromUrl,
} from './sso-url';
import type { StoSsoAuth, StoSsoAuthConfig, StoSsoUser } from './types';

interface PublishedSiteSsoAuthOptions {
  config: StoSsoAuthConfig;
  platform: SsoBrowserPlatform;
  fetch: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function safeTraceId(value: string | null): string | undefined {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 128) return undefined;
  return /^[A-Za-z0-9._:-]+$/.test(normalized) ? normalized : undefined;
}

async function digestCallbackCode(code: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(code),
  );
  return Array.from(new Uint8Array(digest), (byte) => (
    byte.toString(16).padStart(2, '0')
  )).join('');
}

function mapUser(payload: Record<string, unknown>): StoSsoUser {
  const logon = isRecord(payload.userLogOnResult) ? payload.userLogOnResult : {};
  const rawUser = (
    (isRecord(payload.userInfo) && payload.userInfo)
    || (isRecord(payload.UserInfo) && payload.UserInfo)
    || (isRecord(logon.userInfo) && logon.userInfo)
    || (isRecord(logon.UserInfo) && logon.UserInfo)
    || {}
  );
  const userId = stringValue(rawUser, 'Id', 'id', 'EmpCode', 'empCode')
    || stringValue(payload, 'id', 'empCode', 'openId');
  const userName = stringValue(
    rawUser,
    'RealName',
    'realName',
    'NickName',
    'nickName',
    'UserName',
    'userName',
  ) || stringValue(payload, 'realName', 'userName');

  return {
    ...(userId ? { userId } : {}),
    ...(userName ? { userName } : {}),
    ...(stringValue(rawUser, 'EmpCode', 'empCode') ? {
      userCode: stringValue(rawUser, 'EmpCode', 'empCode'),
    } : {}),
    ...(stringValue(rawUser, 'Avatar', 'avatar') ? {
      avatar: stringValue(rawUser, 'Avatar', 'avatar'),
    } : {}),
  };
}

async function parseExchangeResponse(response: Response): Promise<{
  token: string;
  user: StoSsoUser;
}> {
  const traceId = safeTraceId(response.headers.get('x-trace-id'));
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new StoSsoAuthError(
      'SSO_RESPONSE_INVALID',
      'SSO 换票接口返回了无效数据',
      { httpStatus: response.status, traceId },
    );
  }
  if (!response.ok || !isRecord(raw)) {
    throw new StoSsoAuthError(
      'SSO_EXCHANGE_FAILED',
      'SSO 换票失败',
      { httpStatus: response.status, traceId },
    );
  }
  if (raw.success === false || raw.status === false) {
    throw new StoSsoAuthError(
      'SSO_EXCHANGE_FAILED',
      'SSO 换票失败',
      { httpStatus: response.status, traceId },
    );
  }

  const payload = isRecord(raw.data) ? raw.data : raw;
  const logon = isRecord(payload.userLogOnResult) ? payload.userLogOnResult : {};
  const token = stringValue(payload, 'stoToken') || stringValue(logon, 'stoToken');
  if (!token) {
    throw new StoSsoAuthError(
      'SSO_EXCHANGE_FAILED',
      'SSO 换票响应未包含 Token',
      { httpStatus: response.status, traceId },
    );
  }
  return { token, user: mapUser(payload) };
}

export function createPublishedSiteSsoAuth(
  options: PublishedSiteSsoAuthOptions,
): StoSsoAuth {
  const { config, platform, fetch: fetcher } = options;
  let token: string | null = null;
  let user: StoSsoUser | null = null;
  let bootstrapPromise: Promise<void> | null = null;

  function readSessionValue(key: string): string | null {
    try {
      return platform.getSessionStorage(key);
    } catch {
      throw new StoSsoAuthError('SSO_STORAGE_FAILED', '无法读取 SSO 会话状态');
    }
  }

  function writeSessionValue(key: string, value: string): void {
    try {
      platform.setSessionStorage(key, value);
    } catch {
      throw new StoSsoAuthError('SSO_STORAGE_FAILED', '无法保存 SSO 会话状态');
    }
  }

  function removeSessionValueBestEffort(key: string): void {
    try {
      platform.removeSessionStorage(key);
    } catch {
      // Guards expire with the browser session; cleanup must not invalidate login.
    }
  }

  function cleanCallbackUrl(url: string): void {
    try {
      platform.replaceUrl(url);
      return;
    } catch {
      try {
        platform.redirect(url);
      } catch {
        throw new StoSsoAuthError('SSO_EXCHANGE_FAILED', '无法清理 SSO 回调地址');
      }
      throw new StoSsoAuthError('AUTH_REQUIRED', '正在清理 SSO 回调地址');
    }
  }

  function redirectOnce(guardKey: string): never {
    const returnUrl = stripAuthParamsFromUrl(platform.href);
    if (readSessionValue(guardKey) === returnUrl) {
      throw new StoSsoAuthError('SSO_REDIRECT_LOOP', 'SSO 登录重定向已停止');
    }
    writeSessionValue(guardKey, returnUrl);
    platform.redirect(buildSsoLoginUrl(config, platform.href));
    throw new StoSsoAuthError('AUTH_REQUIRED', '正在跳转 STO SSO 登录');
  }

  async function runBootstrap(): Promise<void> {
    const callbackCode = readCallbackCode(platform.href);
    if (callbackCode) {
      const callbackCodeDigest = await digestCallbackCode(callbackCode);
      if (readSessionValue(CALLBACK_CODE_CLAIM_KEY) === callbackCodeDigest) {
        const existingToken = readTokenCookie(platform.cookie);
        if (existingToken && !isTokenExpired(existingToken)) {
          token = existingToken;
          user = readStoredUser(platform);
          cleanCallbackUrl(stripAuthParamsFromUrl(platform.href));
          return;
        }
        throw new StoSsoAuthError('SSO_EXCHANGE_FAILED', 'SSO 回调凭证已被消费');
      }
      writeSessionValue(CALLBACK_CODE_CLAIM_KEY, callbackCodeDigest);
      let session: { token: string; user: StoSsoUser };
      try {
        const response = await fetcher(buildSsoCallbackExchangeUrl(config, callbackCode), {
          method: 'GET',
          credentials: 'omit',
          headers: { Accept: 'application/json' },
        });
        session = await parseExchangeResponse(response);
      } catch (error) {
        // A failed exchange must be retryable after a transient network/SSO error.
        removeSessionValueBestEffort(CALLBACK_CODE_CLAIM_KEY);
        throw error;
      }
      persistSession(platform, session);
      token = session.token;
      user = session.user;
      removeSessionValueBestEffort(REDIRECT_GUARD_KEY);
      removeSessionValueBestEffort(UNAUTHORIZED_GUARD_KEY);
      cleanCallbackUrl(stripAuthParamsFromUrl(platform.href));
      return;
    }

    const existingToken = readTokenCookie(platform.cookie);
    if (existingToken && !isTokenExpired(existingToken)) {
      token = existingToken;
      user = readStoredUser(platform);
      return;
    }

    if (existingToken) clearStoredSession(platform);

    redirectOnce(REDIRECT_GUARD_KEY);
  }

  return {
    bootstrap() {
      if (!bootstrapPromise) {
        bootstrapPromise = runBootstrap().catch((error) => {
          bootstrapPromise = null;
          throw error;
        });
      }
      return bootstrapPromise;
    },
    getToken() {
      if (token && isTokenExpired(token)) {
        clearStoredSession(platform);
        token = null;
        user = null;
      }
      return token;
    },
    getUser() {
      return user;
    },
    async logout() {
      clearStoredSession(platform);
      token = null;
      user = null;
      removeSessionValueBestEffort(REDIRECT_GUARD_KEY);
      removeSessionValueBestEffort(UNAUTHORIZED_GUARD_KEY);
      removeSessionValueBestEffort(CALLBACK_CODE_CLAIM_KEY);
      platform.redirect(buildSsoLoginUrl(config, platform.href));
    },
    async handleUnauthorized() {
      clearStoredSession(platform);
      token = null;
      user = null;
      redirectOnce(UNAUTHORIZED_GUARD_KEY);
    },
  };
}
