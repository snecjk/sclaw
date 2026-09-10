import type { AppEnvironment } from '../../shared/env-config';

function getPortalOrigin(env: AppEnvironment): string {
  if (env === 'development' || env === 'test') return 'https://sclaw-test.sto.cn';
  return 'https://sclaw.sto.cn';
}

export function buildAppPermissionsUrl(
  appCode: string,
  env: AppEnvironment,
  configuredUrl?: string,
): string {
  const origin = getPortalOrigin(env);
  const forceEnvironmentOrigin = env === 'development' || env === 'test';
  const configured = configuredUrl?.trim();
  if (configured) {
    try {
      const resolved = new URL(configured, `${origin}/`);
      if (resolved.protocol === 'https:' || resolved.protocol === 'http:') {
        if (forceEnvironmentOrigin) {
          return new URL(`${resolved.pathname}${resolved.search}${resolved.hash}`, `${origin}/`).toString();
        }
        return resolved.toString();
      }
    } catch {
      // Fall through to the stable route derived from appCode.
    }
  }
  return `${origin}/apps/${encodeURIComponent(appCode)}/permissions`;
}

export function buildAppPermissionsCallbackUrl(permissionsUrl: string): string {
  const target = new URL(permissionsUrl);
  const redirectPath = `${target.pathname}${target.search}${target.hash}`;
  const callback = new URL('/sso/callback', target.origin);
  callback.searchParams.set('redirect', redirectPath);
  return callback.toString();
}

export function buildDirectAppPermissionsLoginUrl(callbackUrl: string, stoToken: string): string {
  const callback = new URL(callbackUrl);
  callback.searchParams.set('stoToken', stoToken);
  return callback.toString();
}
