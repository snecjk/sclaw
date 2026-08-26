/** SSO 各环境用户中心域名（登录页 + 换票 API），供 Vite 代理解析。 */

/** @typedef {'daily' | 'pre' | 'prod'} SsoEnv */

/** @type {Record<SsoEnv, { login: string; api: string }>} */
export const SSO_ENV_PRESETS = {
  daily: {
    login: 'https://baseinfo-usercenterserviceapi-hq-test.sto.cn',
    api: 'https://baseinfo-usercenterapi-hq-test.sto.cn',
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

/** @param {string | undefined} value */
export function normalizeSsoEnv(value) {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  if (v === 'daily' || v === 'test' || v === 'dev') return 'daily';
  if (v === 'pre' || v === 'prepub' || v === 'staging') return 'pre';
  if (v === 'prod' || v === 'production') return 'prod';
  return null;
}

/** @param {Record<string, string | undefined>} env */
export function resolveSsoApiProxyTarget(env) {
  const explicit =
    env.SSO_API_PROXY_TARGET?.trim()
    || env.VITE_SSO_API_PROXY_TARGET?.trim()
    || env.VITE_SSO_API_BASE_URL?.trim();
  if (explicit) return explicit;

  const ssoEnv = normalizeSsoEnv(env.VITE_SSO_ENV) ?? 'prod';
  return SSO_ENV_PRESETS[ssoEnv].api;
}
