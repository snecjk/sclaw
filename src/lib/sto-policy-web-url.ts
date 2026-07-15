/**
 * STO 政策系统（zc*.sto.cn）iframe 嵌入 URL。
 * 走目标域 callback 写 cookie，避免 page.sto.cn SSO 在 iframe 内跨子域丢登录态。
 */
import { getStoPolicyReportApiHost } from '../../shared/env-config';

const POLICY_AUTH_SESSION_KEY = 'stoclaw-sto-policy-web-auth';

export function getStoPolicyWebOrigin(): string {
  return `https://${getStoPolicyReportApiHost()}`;
}

/** 同会话内 iframe 已在政策域写过 session 后，可跳过 callback */
export function isStoPolicyWebAuthedInSession(): boolean {
  try {
    return sessionStorage.getItem(POLICY_AUTH_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

export function markStoPolicyWebAuthedInSession(): void {
  try {
    sessionStorage.setItem(POLICY_AUTH_SESSION_KEY, '1');
  } catch {
    // ignore
  }
}

/** /sso/login/callback?stoToken=&redirect= — 在政策域写 session 后跳转 */
export function buildStoPolicySsoCallbackUrl(
  stoToken: string,
  redirectPath = '/',
): string {
  const base = getStoPolicyWebOrigin();
  const params = new URLSearchParams({ stoToken });
  if (redirectPath) {
    params.set('redirect', redirectPath);
  }
  return `${base}/sso/login/callback?${params.toString()}`;
}

/** 政策域直达 + stotoken 查询参数（多数 STO 业务页支持） */
export function buildStoPolicyTokenLandingUrl(
  stoToken: string,
  redirectPath = '/',
): string {
  const parsed = new URL(buildStoPolicyTargetUrl(redirectPath));
  parsed.searchParams.set('stotoken', stoToken);
  return parsed.toString();
}

/** 政策系统目标页（已登录或无需 token 时直达） */
export function buildStoPolicyTargetUrl(redirectPath = '/'): string {
  const base = getStoPolicyWebOrigin();
  if (!redirectPath || redirectPath === '/') {
    return `${base}/`;
  }
  if (/^https?:\/\//i.test(redirectPath)) {
    return redirectPath;
  }
  return `${base}${redirectPath.startsWith('/') ? redirectPath : `/${redirectPath}`}`;
}

/**
 * iframe 嵌入政策系统 URL：
 * - 同会话已登录：直达目标页
 * - 有 stoToken：callback 写 cookie 后 redirect
 * - 无 token：直达目标页（由业务页自行处理未登录）
 */
export function buildStoPolicyEmbedUrl(
  redirectPath = '/',
  stoToken?: string,
): string {
  const token = stoToken?.trim();
  const targetUrl = buildStoPolicyTargetUrl(redirectPath);
  if (!token || isStoPolicyWebAuthedInSession()) {
    return targetUrl;
  }
  // 优先 stotoken 直达；callback 路径未部署时会 302 回 page.sto.cn SSO
  return buildStoPolicyTokenLandingUrl(token, redirectPath);
}

export interface StoSsoWebUrlMeta {
  systemCode?: string;
  returnUrl?: string;
}

function readStoSsoWebParams(url: URL): URLSearchParams {
  const params = new URLSearchParams(url.search);
  const rawHash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  const queryStart = rawHash.indexOf('?');
  const hashQuery = queryStart >= 0 ? rawHash.slice(queryStart + 1) : '';
  const hashParams = new URLSearchParams(hashQuery);
  hashParams.forEach((value, key) => {
    if (!params.has(key)) params.set(key, value);
  });
  return params;
}

/** 解析 page.sto.cn/sto-sso-web hash 路由参数 */
export function parseStoSsoWebUrl(url: string): StoSsoWebUrlMeta | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('page.sto.cn')) return null;
    if (!parsed.pathname.includes('sto-sso-web')) return null;

    const params = readStoSsoWebParams(parsed);

    return {
      systemCode: params.get('systemCode') ?? undefined,
      returnUrl: params.get('returnUrl') ?? undefined,
    };
  } catch {
    return null;
  }
}

/**
 * 向 page.sto.cn SSO 页注入 autoLogin + token（iframe 内 localStorage 无 token 时用 URL 传参）。
 */
export function injectStoSsoWebAutoLogin(url: string, stoToken: string): string {
  const parsed = new URL(url);
  const params = readStoSsoWebParams(parsed);
  params.set('autoLogin', 'true');
  params.set('stoToken', stoToken);
  params.set('ssoToken', stoToken);

  const rawHash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
  const queryStart = rawHash.indexOf('?');
  const route = queryStart >= 0 ? rawHash.slice(0, queryStart) : rawHash || '/main';

  parsed.search = '';
  parsed.hash = `#${route}?${params.toString()}`;
  return parsed.toString();
}

export function isStoSsoWebUrl(url: string): boolean {
  return parseStoSsoWebUrl(url) !== null;
}

export function isStoPolicyHostUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return (
      host === 'zc.sto.cn'
      || host === 'pre-zc.sto.cn'
      || host === 'zc-test.sto.cn'
    );
  } catch {
    return false;
  }
}
