import { exchangeSsoAuthorizationCode } from './sso-api';
import {
  persistSession,
  readStoredUser,
  readTokenCookie,
  writeTokenCookie,
  clearTokenCookie,
} from './session';
import {
  hasSsoCallbackParams,
  readSsoCallbackAuth,
  releaseExchangeLock,
  stripAuthParamsFromUrl,
  tryAcquireExchangeLock,
} from './sso';

const STO_TOKEN_QUERY_KEYS = ['stoToken', 'stotoken', 'StoToken'] as const;

let bootstrapPromise: Promise<AuthBootstrapResult> | null = null;

export type AuthBootstrapResult =
  | { status: 'ok' }
  | { status: 'exchange_failed'; message: string };

function readQueryToken(search: string): string | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  for (const key of STO_TOKEN_QUERY_KEYS) {
    const value = params.get(key)?.trim();
    if (value) return value;
  }
  return params.get('token')?.trim() || null;
}

/** 宿主注入或 URL 上的 stoToken → cookie，并清理地址栏。 */
export function captureStoTokenFromUrl(href: string = window.location.href): string | null {
  try {
    const url = new URL(href);
    const token = readQueryToken(url.search);
    if (!token) return getStoToken();

    writeTokenCookie(token);
    for (const key of [...STO_TOKEN_QUERY_KEYS, 'token']) {
      url.searchParams.delete(key);
    }
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, '', next);
    return token;
  } catch {
    return getStoToken();
  }
}

export function getStoToken(): string | null {
  return readTokenCookie();
}

export function setStoToken(token: string | null): void {
  if (!token?.trim()) {
    clearTokenCookie();
    return;
  }
  writeTokenCookie(token.trim());
}

async function exchangeCodeFromUrl(code: string): Promise<void> {
  if (!tryAcquireExchangeLock(code)) return;
  try {
    const session = await exchangeSsoAuthorizationCode(code);
    persistSession(session);
    window.history.replaceState(window.history.state, '', stripAuthParamsFromUrl());
  } finally {
    releaseExchangeLock();
  }
}

/**
 * 启动鉴权：
 * 1. URL stoToken（SClaw 预览注入）→ cookie
 * 2. URL code → 用户中心 callback 换票 → cookie + localStorage 用户
 */
export function bootstrapAuthFromUrl(): Promise<AuthBootstrapResult> {
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async (): Promise<AuthBootstrapResult> => {
    if (typeof window === 'undefined') return { status: 'ok' };

    const { token, code } = readSsoCallbackAuth();
    if (token) {
      captureStoTokenFromUrl();
      return { status: 'ok' };
    }

    if (code) {
      try {
        await exchangeCodeFromUrl(code);
        return { status: 'ok' };
      } catch (error) {
        window.history.replaceState(window.history.state, '', stripAuthParamsFromUrl());
        const message = error instanceof Error ? error.message : 'SSO 换票失败';
        console.error('[sso] exchange failed:', message, error);
        bootstrapPromise = null;
        return { status: 'exchange_failed', message };
      }
    }

    if (hasSsoCallbackParams()) {
      captureStoTokenFromUrl();
    }

    return { status: 'ok' };
  })();

  return bootstrapPromise;
}

/** 顶栏展示：优先 localStorage 用户，回退 JWT 解析。 */
export function getUserDisplayFromToken(token: string | null = getStoToken()): {
  name: string;
  code?: string;
} {
  const stored = readStoredUser();
  if (stored) {
    return {
      name: stored.name,
      code: stored.code || stored.empCode,
    };
  }

  if (!token) return { name: '未登录用户' };
  const parts = token.split('.');
  if (parts.length < 2) return { name: '已登录用户' };
  try {
    const normalized = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const json = atob(padded);
    const payload = JSON.parse(json) as Record<string, unknown>;
    const name =
      pickString(payload.realName, payload.userName, payload.name, payload.nickname)
      ?? '已登录用户';
    const code = pickString(payload.userCode, payload.code, payload.empCode, payload.sub);
    return { name, code };
  } catch {
    return { name: '已登录用户' };
  }
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}
