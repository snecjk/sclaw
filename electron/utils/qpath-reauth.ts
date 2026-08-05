/**
 * Single-flight CLI re-auth — delegates to generic open_url engine.
 * @deprecated Prefer ensureCliReauthIfNeeded / ensureConnectorReauthFromRuntime.
 */
import { BrowserWindow } from 'electron';

import { QPATH_AUTH_PATTERNS } from '../../shared/connectors/auth-pattern-presets';
import type { ManagedCliAuthSpec } from '../../shared/connectors/types';
import { ensureCliReauthIfNeeded } from '../connectors/cli-reauth';
import { logger } from './logger';

const QPATH_REAUTH_AUTH: ManagedCliAuthSpec = {
  type: 'cli_login',
  ui: 'open_url',
  openIn: 'embedded',
  login: ['qpath', 'login'],
  status: ['qpath', 'status'],
  logout: ['qpath', 'logout'],
  loginUrlPattern: QPATH_AUTH_PATTERNS.loginUrlPattern,
  loggedInPattern: QPATH_AUTH_PATTERNS.loggedInPattern,
  loggedOutPattern: QPATH_AUTH_PATTERNS.loggedOutPattern,
  authExpiredPattern: QPATH_AUTH_PATTERNS.authExpiredPattern,
  hint: '请在弹窗中完成钉钉登录',
};

/**
 * If `errorText` looks like QPath auth expiry, open login once and return whether
 * authenticated afterwards. Concurrent callers share the same attempt.
 */
export async function ensureQpathReauthIfNeeded(
  errorText: string,
  parentWindow?: BrowserWindow | null,
): Promise<{ attempted: boolean; authenticated: boolean }> {
  return ensureCliReauthIfNeeded({
    errorText,
    auth: QPATH_REAUTH_AUTH,
    binary: 'qpath',
    binDir: '~/.sto/qpath-cli/bin',
    parentWindow,
    connectorId: 'qpath',
    onAuthenticated: async () => {
      try {
        const { getConnectorService } = await import('../connectors');
        await getConnectorService().markQpathConnectedAfterAuth();
      } catch (error) {
        logger.warn(
          '[qpath-reauth] mark connected failed:',
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  });
}

/** Run an async qpath-related action; on auth expiry, reauth once and retry. */
export async function withQpathAuthRetry<T>(
  action: () => Promise<T>,
  options?: {
    parentWindow?: BrowserWindow | null;
    getErrorText?: (error: unknown, result?: T) => string;
    isFailure?: (result: T) => boolean;
  },
): Promise<T> {
  const result = await action();
  if (options?.isFailure && options.isFailure(result)) {
    const text = options.getErrorText?.(null, result) || String(result);
    const reauth = await ensureQpathReauthIfNeeded(text, options.parentWindow);
    if (reauth.attempted && reauth.authenticated) {
      return action();
    }
  }
  return result;
}
