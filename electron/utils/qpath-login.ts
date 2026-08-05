/**
 * QPath login — thin wrapper over generic open_url engine (legacy callers).
 */
import type { BrowserWindow } from 'electron';

import { QPATH_AUTH_PATTERNS } from '../../shared/connectors/auth-pattern-presets';
import type { ManagedCliAuthSpec } from '../../shared/connectors/types';
import { runOpenUrlLogin } from '../connectors/open-url-login';

const QPATH_OPEN_URL_AUTH: ManagedCliAuthSpec = {
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

export async function qpathAuthLogin(parentWindow?: BrowserWindow | null): Promise<{
  ok: boolean;
  error?: string;
  exitCode: number;
}> {
  return runOpenUrlLogin({
    auth: QPATH_OPEN_URL_AUTH,
    binary: 'qpath',
    binDir: '~/.sto/qpath-cli/bin',
    parentWindow,
  });
}
