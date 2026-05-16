/**
 * SSO Authentication State Persistence
 * Separate electron-store instance for auth data, isolated from AppSettings.
 */

import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'node:os';
import { getOpenClawConfigDir, ensureDir } from './paths';
import { logger } from './logger';
import { getCurrentEnvConfig } from '../../shared/env-config';

export type SsoEnvironment =
  | 'daily-external'
  | 'production-external'
  | 'pre-release'
  | 'local';

export interface SsoUserInfo {
  id: string;
  userName: string;
  realName: string;
  companyName: string;
  departmentName: string;
  openId: string;
  signature: string;
  authenticatedAt: string;
  stoToken?: string;
  stoTokenExpiresAt?: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  ssoEnvironment: SsoEnvironment;
  user: SsoUserInfo | null;
  systemCode: string;
}

const SYSTEM_CODE = 'sto_claw';

function createDefaultAuthState(): AuthState {
  return {
    isAuthenticated: false,
    ssoEnvironment: getCurrentEnvConfig().ssoEnvironment as SsoEnvironment,
    user: null,
    systemCode: SYSTEM_CODE,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let authStoreInstance: any = null;

async function getAuthStore() {
  if (!authStoreInstance) {
    const Store = (await import('electron-store')).default;
    authStoreInstance = new Store<AuthState>({
      name: 'sso-auth',
      defaults: createDefaultAuthState(),
    });
  }
  return authStoreInstance;
}

export async function getAuthState(): Promise<AuthState> {
  const store = await getAuthStore();
  const defaultSsoEnv = getCurrentEnvConfig().ssoEnvironment as SsoEnvironment;
  return {
    isAuthenticated: store.get('isAuthenticated', false),
    ssoEnvironment: store.get('ssoEnvironment', defaultSsoEnv),
    user: store.get('user', null),
    systemCode: store.get('systemCode', SYSTEM_CODE),
  };
}

export async function setAuthUser(user: SsoUserInfo): Promise<void> {
  const store = await getAuthStore();
  store.set('isAuthenticated', true);
  store.set('user', user);
  await syncSsoAuthToSaiCli(user);
}

export async function clearAuthUser(): Promise<void> {
  logger.info("Clear auth user...")
  const store = await getAuthStore();
  store.set('isAuthenticated', false);
  store.set('user', null);
  await removeSsoAuthFromSaiCli();
}

export async function getSsoEnvironment(): Promise<SsoEnvironment> {
  const store = await getAuthStore();
  return store.get('ssoEnvironment', getCurrentEnvConfig().ssoEnvironment as SsoEnvironment);
}

export async function setSsoEnvironment(env: SsoEnvironment): Promise<void> {
  const store = await getAuthStore();
  store.set('ssoEnvironment', env);
}

/**
 * Notify all renderer windows that the StoToken has expired so they can
 * redirect to the login page.  Uses dynamic import of `electron` to stay
 * test-friendly (import fails gracefully outside Electron).
 */
async function notifyRendererTokenExpired(): Promise<void> {
  try {
    const { BrowserWindow } = await import('electron');
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('auth:token-expired');
      }
    }
  } catch {
    // Ignore – electron unavailable (unit-test environment).
  }
}

/**
 * Get the stored StoToken (if present and not expired).
 * When an expired token is detected the auth state is automatically cleared
 * and all renderer windows are notified so the UI can redirect to login.
 */
export async function getStoToken(): Promise<string | null> {
  const store = await getAuthStore();
  const user = store.get('user', null) as SsoUserInfo | null;
  if (!user?.stoToken || !user.stoTokenExpiresAt) return null;
  if (new Date(user.stoTokenExpiresAt) <= new Date()) {
    logger.info('StoToken expired, clearing auth state and notifying renderer to redirect to login');
    await clearAuthUser();
    void removeSsoAuthFromOpenClaw();
    void notifyRendererTokenExpired();
    return null;
  }
  return user.stoToken;
}

/**
 * Write SSO user info as a flat JSON file to ~/.openclaw/sso-auth.json
 * so the sto-dynamic-agent-route plugin can read it for header injection.
 */
export async function syncSsoAuthToOpenClaw(user: SsoUserInfo): Promise<void> {
  try {
    const dir = getOpenClawConfigDir();
    ensureDir(dir);
    const filePath = join(dir, 'sso-auth.json');
    logger.info("Sync sso auth to OpenClaw", filePath);
    await writeFile(filePath, JSON.stringify({ ...user }, null, 2), 'utf-8');
  } catch (err) {
    logger.warn('Failed to sync SSO auth to ~/.openclaw/sso-auth.json:', err);
  }
}

/**
 * Write SSO token to ~/.sai/sso-auth.json so SAI CLI can share the login session.
 *
 * Uses the exact format SAI CLI expects (stoToken / expiresAt / userInfo)
 * rather than a generic OAuth envelope so `sai whoami` and dynamic commands
 * work immediately without requiring an interactive `sai login` flow.
 */
export async function syncSsoAuthToSaiCli(user: SsoUserInfo): Promise<void> {
  try {
    const dir = join(homedir(), '.sai');
    ensureDir(dir);
    const filePath = join(dir, 'sso-auth.json');
    logger.info('Sync SSO auth to SAI CLI', filePath);
    await writeFile(
      filePath,
      JSON.stringify(
        {
          stoToken: user.stoToken,
          expiresAt: user.stoTokenExpiresAt,
          userId: user.id,
          userInfo: {
            Id: user.id,
            UserName: user.userName,
            RealName: user.realName,
            NickName: user.realName,
            Code: user.userName,
            CompanyName: user.companyName,
            DepartmentName: user.departmentName,
            OpenId: user.openId,
            Signature: user.signature,
          },
        },
        null,
        2,
      ),
      'utf-8',
    );
  } catch (err) {
    logger.warn('Failed to sync SSO auth to ~/.sai/sso-auth.json:', err);
  }
}

/**
 * Remove ~/.sai/sso-auth.json on logout or token expiry.
 */
export async function removeSsoAuthFromSaiCli(): Promise<void> {
  try {
    const filePath = join(homedir(), '.sai', 'sso-auth.json');
    logger.info('Remove SSO auth from SAI CLI', filePath);
    await unlink(filePath);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') return;
    logger.warn('Failed to remove ~/.sai/sso-auth.json:', err);
  }
}

/**
 * Remove ~/.openclaw/sso-auth.json on logout or token expiry.
 */
export async function removeSsoAuthFromOpenClaw(): Promise<void> {
  try {
    const filePath = join(getOpenClawConfigDir(), 'sso-auth.json');
    logger.info("Remove sso auth from openclaw", filePath)
    await unlink(filePath);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') return;
    logger.warn('Failed to remove ~/.openclaw/sso-auth.json:', err);
  }
}
