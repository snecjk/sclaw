import { readStoSsoAuthConfig } from './config';
import { StoSsoAuthError } from './errors';
import { createSsoAuthProvider } from './provider';
import type { BootstrapSsoAuthOptions, StoSsoAuth } from './types';

let currentAuth: StoSsoAuth | undefined;
let bootstrapPromise: Promise<StoSsoAuth> | undefined;

export async function bootstrapSsoAuth(
  options: BootstrapSsoAuthOptions = {},
): Promise<StoSsoAuth> {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const config = readStoSsoAuthConfig(options.config);
      const auth = createSsoAuthProvider({
        config,
        fetch: options.fetch ?? globalThis.fetch,
        platform: options.platform,
      });
      await auth.bootstrap();
      currentAuth = auth;
      return auth;
    })().catch((error) => {
      bootstrapPromise = undefined;
      throw error;
    });
  }
  return bootstrapPromise;
}

export function getSsoAuth(): StoSsoAuth {
  if (!currentAuth) {
    throw new StoSsoAuthError('AUTH_REQUIRED', 'SSO Auth 尚未完成初始化');
  }
  return currentAuth;
}

export { readStoSsoAuthConfig } from './config';
export { StoSsoAuthError, STO_SSO_AUTH_ERROR_CODES } from './errors';
export type { SsoBrowserPlatform } from './browser-platform';
export type * from './types';
