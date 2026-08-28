import { StoSsoAuthError } from './errors';
import type { StoSsoAuthConfig, StoSsoSiteAuthConfig } from './types';

const AUTH_QUERY_KEYS = ['code', 'authorizationCode', 'stoToken', 'stotoken', 'StoToken', 'token'];

function requireSso(config: StoSsoAuthConfig): NonNullable<StoSsoSiteAuthConfig['sso']> {
  if (!('sso' in config) || !config.sso) {
    throw new StoSsoAuthError('SSO_AUTH_CONFIG_INVALID', '发布态缺少 SSO 配置');
  }
  return config.sso;
}

export function buildSsoCallbackExchangeUrl(
  config: StoSsoAuthConfig,
  code: string,
): string {
  const { apiOrigin } = requireSso(config);
  const params = new URLSearchParams({ code });
  return `${apiOrigin}/sso/login/callback?${params.toString()}`;
}

function buildReturnUrl(href: string): string {
  const url = new URL(href);
  for (const key of AUTH_QUERY_KEYS) url.searchParams.delete(key);
  url.searchParams.set('code', '{0}');
  return url.toString();
}

export function buildSsoLoginUrl(config: StoSsoAuthConfig, href: string): string {
  const { loginOrigin, systemCode } = requireSso(config);
  const params = new URLSearchParams({
    autoLogin: 'false',
    systemCode,
    returnUrl: buildReturnUrl(href),
  });
  return `${loginOrigin}/Authenticate/Login?${params.toString()}`;
}

export function readCallbackCode(href: string): string | null {
  const url = new URL(href);
  return (
    url.searchParams.get('code')?.trim()
    || url.searchParams.get('authorizationCode')?.trim()
    || null
  );
}

export function stripAuthParamsFromUrl(href: string): string {
  const url = new URL(href);
  for (const key of AUTH_QUERY_KEYS) url.searchParams.delete(key);
  return `${url.pathname}${url.search}${url.hash}`;
}
