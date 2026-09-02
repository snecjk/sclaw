/**
 * 财务 BI API / 页面域名。
 *
 * 「我的报表」原生换票优先按 skip-login URL 推断 API，
 * 与 preview `/login` → `/login/sto/exchange` 同环境，避免 test API + prod code。
 */
import { getAppEnv, type AppEnvironment } from './env-config';

export const STO_FINANCE_BI_SYSTEM_CODE = 'sto-finance-bi';

/** 与 bi-preview 嵌入目标一致：生产 page */
export const FINANCE_BI_EMBED_PAGE_ORIGIN = 'https://page.sto.cn';

const API_BY_ENV: Record<AppEnvironment, string> = {
  development: 'https://finance-bi-test.sto.cn',
  test: 'https://finance-bi-test.sto.cn',
  staging: 'https://pre-finance-bi.sto.cn',
  production: 'https://finance-bi.sto.cn',
};

const PAGE_ORIGIN_BY_ENV: Record<AppEnvironment, string> = {
  development: 'https://page-test.sto.cn',
  test: 'https://page-test.sto.cn',
  staging: 'https://pre-page.sto.cn',
  production: 'https://page.sto.cn',
};

export function getFinanceBiApiBase(env: AppEnvironment = getAppEnv()): string {
  return API_BY_ENV[env] ?? API_BY_ENV.production;
}

export function getFinanceBiPageOrigin(env: AppEnvironment = getAppEnv()): string {
  // 与现有嵌入策略一致：未单独配置时跟嵌入页走生产 page
  if (env === 'development' || env === 'test') {
    // 开发期若仍嵌入 page.sto.cn，默认也用生产 page 做域名推断兜底
    return FINANCE_BI_EMBED_PAGE_ORIGIN;
  }
  return PAGE_ORIGIN_BY_ENV[env] ?? PAGE_ORIGIN_BY_ENV.production;
}
