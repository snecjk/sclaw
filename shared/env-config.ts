/**
 * Multi-Environment Configuration
 * Single source of truth for per-environment settings.
 *
 * The build environment is baked in at compile time via VITE_APP_ENV
 * (set by Vite --mode and .env.[mode] files).
 */

export type AppEnvironment = 'development' | 'test' | 'staging' | 'production';

export interface EnvConfig {
  /** SSO environment identifier used by auth-store / sso-service */
  ssoEnvironment: 'daily-external' | 'pre-release' | 'production-external' | 'production-internal' | 'local';
  /** OSS base URL for auto-update feed (channel is appended at runtime) */
  updateBaseUrl: string;
  /** Suffix shown in title bar, tray, window title (empty for production) */
  displaySuffix: string;
  /** Human-readable label for the environment */
  displayLabel: string;
  /** Badge color (CSS color string) for UI indicators */
  badgeColor: string;
  /** Whether this is the production environment */
  isProduction: boolean;
  /** Whether this is the development environment (pnpm dev) */
  isDevelopment: boolean;
}

const OSS_BASE_TEST = 'https://ali-sto-wisdom-star-test.oss-cn-shanghai.aliyuncs.com';
const OSS_BASE_PROD = 'https://ali-sto-wisdom-star.oss-cn-shanghai.aliyuncs.com';
const OSS_PATH = '/ai-memory-center/stoclaw/releases';

const ENV_CONFIGS: Record<AppEnvironment, EnvConfig> = {
  development: {
    ssoEnvironment: 'daily-external',
    updateBaseUrl: `${OSS_BASE_TEST}${OSS_PATH}`,
    displaySuffix: '[DEV]',
    displayLabel: 'Development',
    badgeColor: '#6b7280', // gray
    isProduction: false,
    isDevelopment: true,
  },
  test: {
    ssoEnvironment: 'daily-external',
    updateBaseUrl: `${OSS_BASE_TEST}${OSS_PATH}`,
    displaySuffix: '[TEST]',
    displayLabel: 'Test',
    badgeColor: '#f59e0b', // amber
    isProduction: false,
    isDevelopment: false,
  },
  staging: {
    ssoEnvironment: 'pre-release',
    updateBaseUrl: `${OSS_BASE_PROD}${OSS_PATH}`,
    displaySuffix: '[STAGING]',
    displayLabel: 'Staging',
    badgeColor: '#f97316', // orange
    isProduction: false,
    isDevelopment: false,
  },
  production: {
    ssoEnvironment: 'production-external',
    updateBaseUrl: `${OSS_BASE_PROD}${OSS_PATH}`,
    displaySuffix: '',
    displayLabel: 'Production',
    badgeColor: '',
    isProduction: true,
    isDevelopment: false,
  },
};

/**
 * Get the environment config for the given environment name.
 * Falls back to production for unknown values.
 */
export function getEnvConfig(env: string): EnvConfig {
  return ENV_CONFIGS[env as AppEnvironment] ?? ENV_CONFIGS.production;
}

/**
 * Get the current environment config based on the compile-time VITE_APP_ENV.
 */
export function getCurrentEnvConfig(): EnvConfig {
  const env = (import.meta.env.VITE_APP_ENV as string) || 'production';
  return getEnvConfig(env);
}

/**
 * Get the raw app environment string.
 */
export function getAppEnv(): AppEnvironment {
  const env = (import.meta.env.VITE_APP_ENV as string) || 'production';
  return (ENV_CONFIGS[env as AppEnvironment] ? env : 'production') as AppEnvironment;
}

/**
 * STO 策略域 Host（CRM 周报白名单等），**仅**由编译时 `VITE_APP_ENV` 决定，与 SSO 环境无关。
 */
export function getStoPolicyReportApiHostForAppEnv(env: AppEnvironment): string {
  if (env === 'development' || env === 'test') return 'zc-test.sto.cn';
  if (env === 'staging') return 'pre-zc.sto.cn';
  return 'zc.sto.cn';
}

export function getStoPolicyReportApiHost(): string {
  return getStoPolicyReportApiHostForAppEnv(getAppEnv());
}

/**
 * STO 代码应用（code-applications）策略域 Host。
 * 测试环境契约：https://zc-hybrid-test.sto.cn/sto-policy/api/v1/code-applications
 * 实际请求按 SSO 登录环境选择，不能只看编译时 VITE_APP_ENV（DEV 可切生产登录）。
 */
export function getStoPolicyHybridApiHostForAppEnv(env: AppEnvironment): string {
  if (env === 'development' || env === 'test') return 'zc-hybrid-test.sto.cn';
  if (env === 'staging') return 'pre-zc-hybrid.sto.cn';
  return 'zc-hybrid.sto.cn';
}

export function getStoPolicyHybridApiHostForSsoEnv(ssoEnv: string): string {
  if (ssoEnv === 'daily-external' || ssoEnv === 'local') return 'zc-hybrid-test.sto.cn';
  if (ssoEnv === 'pre-release') return 'pre-zc-hybrid.sto.cn';
  return 'zc-hybrid.sto.cn';
}

export function getStoPolicyHybridApiHost(): string {
  return getStoPolicyHybridApiHostForAppEnv(getAppEnv());
}
