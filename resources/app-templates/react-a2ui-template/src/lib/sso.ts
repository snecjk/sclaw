import { buildSsoLoginUrl } from './sso-config';
import { clearSession, readTokenCookie } from './session';

const EXCHANGE_LOCK_KEY = 'sclaw.app.sso.exchangeLock';

export function readSsoCallbackAuth(search = typeof window !== 'undefined' ? window.location.search : '') {
  const params = new URLSearchParams(search);
  return {
    token: params.get('stoToken') || params.get('token'),
    code: params.get('code') || params.get('authorizationCode'),
  };
}

export function hasSsoCallbackParams(search = typeof window !== 'undefined' ? window.location.search : '') {
  const params = new URLSearchParams(search);
  return Boolean(
    params.get('code')
    || params.get('authorizationCode')
    || params.get('stoToken')
    || params.get('token'),
  );
}

export function stripAuthParamsFromUrl(href: string = window.location.href): string {
  try {
    const url = new URL(href);
    for (const key of ['code', 'authorizationCode', 'stoToken', 'stotoken', 'StoToken', 'token']) {
      url.searchParams.delete(key);
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return href;
  }
}

export function tryAcquireExchangeLock(code: string): boolean {
  const locked = sessionStorage.getItem(EXCHANGE_LOCK_KEY);
  if (locked === code) return false;
  sessionStorage.setItem(EXCHANGE_LOCK_KEY, code);
  return true;
}

export function releaseExchangeLock() {
  sessionStorage.removeItem(EXCHANGE_LOCK_KEY);
}

export function hasAuthorizationCode(search = typeof window !== 'undefined' ? window.location.search : '') {
  const params = new URLSearchParams(search);
  return Boolean(params.get('code') || params.get('authorizationCode'));
}

export function redirectToSsoLogin(): void {
  window.location.href = buildSsoLoginUrl();
}

export function isLoggedIn(): boolean {
  return !!readTokenCookie();
}

/**
 * cookie 无 stoToken 时跳转 SSO 登录。
 * URL 带 code（换票回调）或 stoToken 时不跳转，避免打断换票/注入流程。
 * @returns 是否已发起 SSO 跳转
 */
export function checkAndRedirectToLogin(): boolean {
  if (hasSsoCallbackParams()) return false;

  if (!isLoggedIn()) {
    redirectToSsoLogin();
    return true;
  }

  return false;
}

export function logout(): void {
  clearSession();
  redirectToSsoLogin();
}
