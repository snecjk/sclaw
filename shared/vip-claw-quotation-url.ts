/**
 * VIP 报价确认页（SClaw clawQuotation）URL — 按编译环境选 host。
 * 业务约定：`/sclaw/clawQuotation?ossKey=<key>`；勿用 webview reload（业务改 URL 后 reload 会回首页）。
 */
import { getAppEnv, type AppEnvironment } from './env-config';

const VIP_CLAW_QUOTATION_HOST_BY_ENV: Record<AppEnvironment, string> = {
  development: 'https://wd-vip-test.sto.cn',
  test: 'https://wd-vip-test.sto.cn',
  staging: 'https://wd-vip-pre.sto.cn',
  production: 'https://wd-vip.sto.cn',
};

export function getVipClawQuotationHost(env: AppEnvironment = getAppEnv()): string {
  return VIP_CLAW_QUOTATION_HOST_BY_ENV[env] ?? VIP_CLAW_QUOTATION_HOST_BY_ENV.production;
}

/** Build `…/sclaw/clawQuotation?ossKey=…` for the current (or given) app env. */
export function buildVipClawQuotationUrl(ossKey: string, env: AppEnvironment = getAppEnv()): string {
  const key = ossKey.trim();
  const host = getVipClawQuotationHost(env);
  if (!key) return `${host}/sclaw/clawQuotation`;
  return `${host}/sclaw/clawQuotation?ossKey=${encodeURIComponent(key)}`;
}

export function isVipClawQuotationUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return /\/sclaw\/clawQuotation\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}
