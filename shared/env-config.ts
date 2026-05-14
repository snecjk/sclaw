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
  ssoEnvironment: 'daily-external' | 'pre-release' | 'production-external' | 'local';
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

const OSS_BASE = 'https://ali-sto-wisdom-star.aliyuncs.com';

const ENV_CONFIGS: Record<AppEnvironment, EnvConfig> = {
  development: {
    ssoEnvironment: 'daily-external',
    updateBaseUrl: OSS_BASE,
    displaySuffix: '[DEV]',
    displayLabel: 'Development',
    badgeColor: '#6b7280', // gray
    isProduction: false,
    isDevelopment: true,
  },
  test: {
    ssoEnvironment: 'daily-external',
    updateBaseUrl: `${OSS_BASE}/test`,
    displaySuffix: '[TEST]',
    displayLabel: 'Test',
    badgeColor: '#f59e0b', // amber
    isProduction: false,
    isDevelopment: false,
  },
  staging: {
    ssoEnvironment: 'pre-release',
    updateBaseUrl: `${OSS_BASE}/staging`,
    displaySuffix: '[STAGING]',
    displayLabel: 'Staging',
    badgeColor: '#f97316', // orange
    isProduction: false,
    isDevelopment: false,
  },
  production: {
    ssoEnvironment: 'production-external',
    updateBaseUrl: OSS_BASE,
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
