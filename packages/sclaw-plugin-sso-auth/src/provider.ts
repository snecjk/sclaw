import { createBrowserPlatform, type SsoBrowserPlatform } from './browser-platform';
import { createLocalSsoAuth } from './local-auth';
import { createPublishedSiteSsoAuth } from './site-sso';
import type { StoSsoAuth, StoSsoAuthConfig } from './types';

export function createSsoAuthProvider(options: {
  config: StoSsoAuthConfig;
  fetch: typeof fetch;
  platform?: SsoBrowserPlatform;
}): StoSsoAuth {
  if (options.config.runtimeMode === 'local') {
    return createLocalSsoAuth({ fetch: options.fetch });
  }
  return createPublishedSiteSsoAuth({
    config: options.config,
    fetch: options.fetch,
    platform: options.platform ?? createBrowserPlatform(),
  });
}
