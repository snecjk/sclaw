/**
 * SSO 环境：daily=测试 pre=预发 prod=生产。
 * - 部署环境按 host 识别（daily/test → 测试，pre- → 预发，其余 → 生产）
 * - 本地 localhost 可通过 VITE_SSO_ENV 指定联调目标（默认 daily 测试）
 */

export type SsoEnv = 'daily' | 'pre' | 'prod';

export type AppEnv = 'dev' | 'daily' | 'pre' | 'prod';

const SSO_ENV_PRESETS: Record<SsoEnv, { login: string; api: string }> = {
  daily: {
    login: 'https://baseinfo-usercenterserviceapi-hq-test.sto.cn',
    api: 'https://baseinfo-usercenterapi-test.sto.cn',
  },
  pre: {
    login: 'https://pre-baseinfo-usercenterservice-api-hq.sto.cn',
    api: 'https://pre-baseinfo-usercenterapi.sto.cn',
  },
  prod: {
    login: 'https://baseinfo-usercenterserviceapi.sto.cn',
    api: 'https://baseinfo-usercenterapi.sto.cn',
  },
};

function normalizeSsoEnv(value: string | undefined): SsoEnv | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v === 'daily' || v === 'test' || v === 'dev') return 'daily';
  if (v === 'pre' || v === 'prepub' || v === 'staging') return 'pre';
  if (v === 'prod' || v === 'production') return 'prod';
  return null;
}

const host = typeof window !== 'undefined' ? window.location.host : '';

/** 运行环境：dev=本地；部署后按 host 识别 daily / pre / prod。 */
export const APP_ENV: AppEnv = /local|127\.0\.0\.1|localhost/.test(host)
  ? 'dev'
  : /daily|test/.test(host)
    ? 'daily'
    : /pre-/.test(host)
      ? 'pre'
      : 'prod';

/** 当前 SSO 联调/部署环境。本地 dev 读 VITE_SSO_ENV，默认 daily（测试）。 */
export function resolveSsoEnv(): SsoEnv {
  const fromEnv = normalizeSsoEnv(import.meta.env.VITE_SSO_ENV);
  if (APP_ENV === 'dev') return fromEnv ?? 'prod';
  if (APP_ENV === 'daily') return 'daily';
  if (APP_ENV === 'pre') return 'pre';
  return 'prod';
}

export const SSO_ENV = resolveSsoEnv();

/** 子系统编码，需在用户中心申请回调地址。 */
export const SSO_SYSTEM_CODE = import.meta.env.VITE_SSO_SYSTEM_CODE || 'STO_CLAW_APP';

export const SSO_LOGIN_BASE_URL =
  import.meta.env.VITE_SSO_BASE_URL?.trim()
  || SSO_ENV_PRESETS[SSO_ENV].login;

export const SSO_API_BASE_URL =
  import.meta.env.VITE_SSO_API_BASE_URL?.trim()
  || SSO_ENV_PRESETS[SSO_ENV].api;

/** Code 换票：本地 dev 走 Vite `/sso-api` 代理，部署环境直连用户中心 API。 */
export function buildSsoCallbackExchangeUrl(code: string): string {
  const params = new URLSearchParams({ code });
  if (APP_ENV === 'dev') {
    return `/sso-api/sso/login/callback?${params.toString()}`;
  }
  return `${SSO_API_BASE_URL}/sso/login/callback?${params.toString()}`;
}

/** SSO 登录页（扫码/账号），returnUrl 中的 `{0}` 由用户中心替换为 code。 */
export function buildSsoLoginUrl(returnUrl?: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
  const callback = returnUrl ?? `${origin}${pathname}?code={0}`;
  const params = new URLSearchParams({
    autoLogin: 'false',
    systemCode: SSO_SYSTEM_CODE,
    returnUrl: callback,
  });
  return `${SSO_LOGIN_BASE_URL}/Authenticate/Login?${params.toString()}`;
}
