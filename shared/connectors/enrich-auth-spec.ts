/**
 * Fill missing open_url auth fields from known binary presets (migration aid).
 * Server should still publish full descriptors; this avoids hard-failing incomplete catalogs.
 */
import { normalizeLoginUrlPatterns } from './auth-output-match';
import { DWS_AUTH_PATTERNS, QPATH_AUTH_PATTERNS } from './auth-pattern-presets';
import type { ManagedCliAuthSpec } from './types';

function normalizeBinary(binary: string): string {
  return binary.trim().toLowerCase().replace(/\.exe$/i, '');
}

export function enrichManagedCliAuthSpec(
  auth: ManagedCliAuthSpec | null,
  binary: string,
): ManagedCliAuthSpec | null {
  if (!auth) return null;
  const b = normalizeBinary(binary);
  const presets = b === 'qpath' ? QPATH_AUTH_PATTERNS : b === 'dws' ? DWS_AUTH_PATTERNS : null;
  if (!presets) return auth;

  const hasPattern = normalizeLoginUrlPatterns(auth.loginUrlPattern).length > 0;
  const wantsCapture =
    auth.ui === 'open_url' || auth.ui === 'embedded' || (!auth.ui && Boolean(auth.login?.length));

  if (!wantsCapture) return auth;

  return {
    ...auth,
    ui: auth.ui === 'none' ? 'none' : 'open_url',
    openIn: auth.openIn ?? 'embedded',
    loginUrlPattern: hasPattern ? auth.loginUrlPattern : presets.loginUrlPattern,
    loggedInPattern: auth.loggedInPattern ?? presets.loggedInPattern,
    loggedOutPattern: auth.loggedOutPattern ?? presets.loggedOutPattern,
    authExpiredPattern: auth.authExpiredPattern ?? presets.authExpiredPattern,
    blockSystemOpen: auth.blockSystemOpen ?? b === 'dws',
    loginWindows:
      auth.loginWindows
      ?? (b === 'dws' ? ['dws', 'auth', 'login', '--device', '--force'] : undefined),
    login:
      auth.login
      ?? (b === 'dws' ? ['dws', 'auth', 'login', '--force'] : b === 'qpath' ? ['qpath', 'login'] : undefined),
    status:
      auth.status
      ?? (b === 'dws'
        ? ['dws', 'auth', 'status', '--format', 'json']
        : b === 'qpath'
          ? ['qpath', 'status']
          : undefined),
    logout:
      auth.logout
      ?? (b === 'dws' ? ['dws', 'auth', 'logout'] : b === 'qpath' ? ['qpath', 'logout'] : undefined),
  };
}
