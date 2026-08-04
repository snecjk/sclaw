/**
 * Decide how managed_cli should authorize — server auth descriptor first, legacy binary last.
 */
import { normalizeLoginUrlPatterns } from './auth-output-match';
import { enrichManagedCliAuthSpec } from './enrich-auth-spec';
import type { ManagedCliAuthSpec } from './types';

export type ManagedCliAuthMode =
  | { mode: 'api_token' }
  | { mode: 'open_url' }
  | { mode: 'login_argv' }
  | { mode: 'legacy'; binary: string }
  | { mode: 'unsupported'; binary: string };

function normalizeBinary(binary: string): string {
  return binary.trim().toLowerCase().replace(/\.exe$/i, '');
}

function wantsOpenUrl(auth: ManagedCliAuthSpec | null): boolean {
  if (!auth) return false;
  const ui = auth.ui;
  if (ui === 'none') return false;
  if (ui === 'open_url' || ui === 'embedded') return true;
  return normalizeLoginUrlPatterns(auth.loginUrlPattern).length > 0;
}

/**
 * Resolve auth execution mode from parsed auth spec + binary.
 * Incomplete open_url catalogs are enriched with known binary presets before deciding.
 */
export function resolveManagedCliAuthMode(options: {
  binary: string;
  auth: ManagedCliAuthSpec | null;
  /** Raw auth.type when parse failed / omitted */
  rawAuthType?: string;
}): ManagedCliAuthMode {
  const binary = normalizeBinary(options.binary);
  const auth = enrichManagedCliAuthSpec(options.auth, binary);
  const rawType = (auth?.type || options.rawAuthType || '').toLowerCase();

  const authType =
    rawType === 'api_token' || rawType === 'token'
      ? 'api_token'
      : rawType === 'cli_login'
        ? 'cli_login'
        : binary === 'glab'
          ? 'api_token'
          : 'cli_login';

  if (authType === 'api_token') {
    return { mode: 'api_token' };
  }

  const hasLogin = Boolean(auth?.login && auth.login.length > 0);
  const hasUrlPattern = normalizeLoginUrlPatterns(auth?.loginUrlPattern).length > 0;

  if (wantsOpenUrl(auth) && hasLogin && hasUrlPattern) {
    return { mode: 'open_url' };
  }

  if (wantsOpenUrl(auth) && hasLogin && !hasUrlPattern) {
    // Unknown binary asked for open_url without pattern — cannot proceed.
    if (binary === 'dws' || binary === 'qpath') {
      return { mode: 'legacy', binary };
    }
    return { mode: 'unsupported', binary };
  }

  if (hasLogin && (auth?.ui === 'none' || !wantsOpenUrl(auth))) {
    return { mode: 'login_argv' };
  }

  if (binary === 'dws' || binary === 'qpath' || binary === 'glab') {
    return { mode: 'legacy', binary };
  }

  return { mode: 'unsupported', binary };
}
