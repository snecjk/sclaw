/**
 * SSO Authentication State Persistence
 * Separate electron-store instance for auth data, isolated from AppSettings.
 */

import { readFile, writeFile, unlink } from 'fs/promises';
import { watch } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'node:os';
import { getOpenClawConfigDir, ensureDir } from './paths';
import { logger } from './logger';
import { getCurrentEnvConfig } from '../../shared/env-config';

export type SsoEnvironment =
  | 'daily-external'
  | 'production-external'
  | 'production-internal'
  | 'pre-release'
  | 'local';

export interface SsoUserInfo {
  id: string;
  userName: string;
  realName: string;
  code: string; // 梧桐工号（基础资料）（老系统的工号）
  empCode: string; // 工号（轩辕系统的）（新系统的工号）（新入职员工这两个工号都一样）
  companyName: string;
  departmentName: string;
  categoryCode: string; // 用户类别编码：独立网点、承包区等
  openId: string;
  signature: string;
  authenticatedAt: string;
  stoToken?: string;
  stoTokenExpiresAt?: string;
}

// Re-export shared site-user utilities so main-process callers import from one place.
export { isSiteUser, setSiteDepartmentTypes, getSiteDepartmentTypes } from '../../shared/site-user-utils';

export interface AuthState {
  isAuthenticated: boolean;
  ssoEnvironment: SsoEnvironment;
  user: SsoUserInfo | null;
  systemCode: string;
}

type JsonObject = Record<string, unknown>;

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

// Watcher for ~/.sai/sso-auth.json to detect external changes (e.g., sai-cli logout)
let saiAuthWatcher: AsyncIterable<{ filename: string | null }> | null = null;
let isWatcherActive = false;

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
  // Primary: read from ~/.sai/sso-auth.json as the single source of truth
  const saiAuthPath = join(homedir(), '.sai', 'sso-auth.json');
  const saiAuth = await readSaiCliSsoAuthFile(saiAuthPath);
  
  if (saiAuth?.stoToken && saiAuth?.expiresAt) {
    const userInfo = isPlainObject(saiAuth.userInfo) ? saiAuth.userInfo : {};
    return {
      isAuthenticated: true,
      ssoEnvironment: getCurrentEnvConfig().ssoEnvironment as SsoEnvironment,
      user: {
        id: String(saiAuth.userId ?? ''),
        userName: String(userInfo.UserName ?? ''),
        realName: String(userInfo.RealName ?? ''),
        code: String(userInfo.Code ?? ''),
        empCode: String(userInfo.Code ?? ''),
        companyName: String(userInfo.CompanyName ?? ''),
        departmentName: String(userInfo.DepartmentName ?? ''),
        categoryCode: String(userInfo.CategoryCode ?? ''),
        openId: String(userInfo.OpenId ?? ''),
        signature: String(userInfo.Signature ?? ''),
        authenticatedAt: new Date().toISOString(),
        stoToken: String(saiAuth.stoToken),
        stoTokenExpiresAt: String(saiAuth.expiresAt),
      },
      systemCode: SYSTEM_CODE,
    };
  }
  
  // Fallback: electron-store for backward compatibility (migration scenario)
  const store = await getAuthStore();
  const defaultSsoEnv = getCurrentEnvConfig().ssoEnvironment as SsoEnvironment;
  const storedUser = store.get('user', null) as SsoUserInfo | null;
  if (storedUser?.stoToken && storedUser.stoTokenExpiresAt) {
    // Migrate to ~/.sai/sso-auth.json
    await syncSsoAuthToSaiCli(storedUser);
  }
  return {
    isAuthenticated: store.get('isAuthenticated', false),
    ssoEnvironment: store.get('ssoEnvironment', defaultSsoEnv),
    user: storedUser,
    systemCode: store.get('systemCode', SYSTEM_CODE),
  };
}

export async function setAuthUser(user: SsoUserInfo): Promise<void> {
  // Primary storage: ~/.sai/sso-auth.json
  await syncSsoAuthToSaiCli(user);
  
  // Cache: electron-store (for backward compatibility)
  const store = await getAuthStore();
  store.set('isAuthenticated', true);
  store.set('user', user);
  
  // Sync to OpenClaw plugin
  await syncSsoAuthToOpenClaw(user);
}

export async function clearAuthUser(): Promise<void> {
  const store = await getAuthStore();
  const previousUser = store.get('user', null) as SsoUserInfo | null;
  logger.info('Clear auth user...');
  store.set('isAuthenticated', false);
  store.set('user', null);
  await removeSsoAuthFromSaiCli(previousUser);
  await removeSsoAuthFromOpenClaw();
}

export async function getSsoEnvironment(): Promise<SsoEnvironment> {
  // 始终以编译时环境为准，避免旧 auth store 中存储的 ssoEnvironment
  // 导致测试包打到生产服务器（auth store 跨安装共享）
  return getCurrentEnvConfig().ssoEnvironment as SsoEnvironment;
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
 * Start watching ~/.sai/sso-auth.json for external changes.
 * When the file is deleted or modified (e.g., by sai-cli logout),
 * automatically clear auth state and notify renderer.
 */
export async function startSaiAuthWatcher(): Promise<void> {
  if (isWatcherActive) return;
  
  try {
    const filePath = join(homedir(), '.sai', 'sso-auth.json');
    const dirPath = join(homedir(), '.sai');
    
    // Watch the directory since unlinking the file won't trigger a file watch
    const watcher = watch(dirPath, { persistent: false, recursive: false });
    saiAuthWatcher = watcher as unknown as AsyncIterable<{ filename: string | null }>;
    isWatcherActive = true;
    
    logger.info('[AuthWatcher] Started watching ~/.sai/ for sso-auth.json changes');
    
    // Run watcher in background
    (async () => {
      try {
        for await (const event of watcher) {
          const filename = event.filename;
          if (filename === 'sso-auth.json' || filename === 'sso-auth.json.reset.*' || (typeof filename === 'string' && filename.startsWith('sso-auth.json.reset.'))) {
            logger.info('[AuthWatcher] Detected sso-auth.json change, checking auth state...');
            // Small delay to ensure file operation completed
            await new Promise(resolve => setTimeout(resolve, 100));
            const auth = await readSaiCliSsoAuthFile(filePath);
            if (!auth?.stoToken || !auth.expiresAt) {
              logger.info('[AuthWatcher] SSO auth file removed or invalidated, clearing auth state');
              await clearAuthUser();
              void notifyRendererTokenExpired();
            }
          }
        }
      } catch (err) {
        if (isWatcherActive) {
          logger.warn('[AuthWatcher] Watcher error:', err);
        }
      }
    })();
  } catch (err) {
    logger.warn('[AuthWatcher] Failed to start watcher:', err);
  }
}

/**
 * Stop the SAI auth watcher.
 */
export async function stopSaiAuthWatcher(): Promise<void> {
  if (!isWatcherActive || !saiAuthWatcher) return;
  
  isWatcherActive = false;
  // Note: fs.watch() doesn't have a direct stop method, but setting the flag
  // prevents further processing. The iterator will be GC'd when no longer referenced.
  logger.info('[AuthWatcher] Stopped watching ~/.sai/ for sso-auth.json changes');
}

/**
 * Get the stored StoToken (if present and not expired).
 * When an expired token is detected the auth state is automatically cleared
 * and all renderer windows are notified so the UI can redirect to login.
 */
export async function getStoToken(): Promise<string | null> {
  // Primary: read from ~/.sai/sso-auth.json
  const filePath = join(homedir(), '.sai', 'sso-auth.json');
  const auth = await readSaiCliSsoAuthFile(filePath);
  if (!auth?.stoToken || !auth.expiresAt) return null;
  const expiresAtStr = String(auth.expiresAt);
  if (new Date(expiresAtStr) <= new Date()) {
    logger.info('StoToken expired, clearing auth state and notifying renderer to redirect to login');
    await clearAuthUser();
    void notifyRendererTokenExpired();
    return null;
  }
  return String(auth.stoToken);
}

/**
 * Write SSO user info as a flat JSON file to ~/.stoclaw/openclaw/sso-auth.json
 * so the sto-dynamic-agent-route plugin can read it for header injection.
 */
export async function syncSsoAuthToOpenClaw(user: SsoUserInfo): Promise<void> {
  try {
    const dir = getOpenClawConfigDir();
    ensureDir(dir);
    const filePath = join(dir, 'sso-auth.json');
    logger.info('Sync sso auth to OpenClaw', filePath);
    await writeFile(filePath, JSON.stringify({ ...user }, null, 2), 'utf-8');
  } catch (err) {
    logger.warn('Failed to sync SSO auth to ~/.stoclaw/openclaw/sso-auth.json:', err);
  }
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readSaiCliSsoAuthFile(filePath: string): Promise<JsonObject | null> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) {
      logger.warn('Existing ~/.sai/sso-auth.json is not a JSON object, it will be replaced');
      return null;
    }
    return parsed;
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    logger.warn('Failed to read existing ~/.sai/sso-auth.json, it will be replaced:', err);
    return null;
  }
}

function buildSaiCliSsoAuthPayload(user: SsoUserInfo, existing: JsonObject | null): JsonObject {
  const existingUserInfo = isPlainObject(existing?.userInfo) ? existing.userInfo : {};

  return {
    ...(existing ?? {}),
    stoToken: user.stoToken,
    expiresAt: user.stoTokenExpiresAt,
    userId: user.id,
    userInfo: {
      ...existingUserInfo,
      Id: user.id,
      UserName: user.userName,
      RealName: user.realName,
      NickName: user.realName,
      Code: user.userName,
      CompanyName: user.companyName,
      DepartmentName: user.departmentName,
      CategoryCode: user.categoryCode,
      OpenId: user.openId,
      Signature: user.signature,
    },
  };
}

function normalizeJsonFileContent(value: JsonObject): string {
  return JSON.stringify(value, null, 2);
}

function shouldRemoveSaiCliSsoAuth(existing: JsonObject, user: SsoUserInfo | null): boolean {
  if (!user) return false;

  const storedToken = typeof existing.stoToken === 'string' ? existing.stoToken : null;
  if (storedToken && user.stoToken) {
    return storedToken === user.stoToken; 
  }

  const storedUserId = typeof existing.userId === 'string' ? existing.userId : null;
  const storedUserName =
    isPlainObject(existing.userInfo) && typeof existing.userInfo.UserName === 'string'
      ? existing.userInfo.UserName
      : null;

  return storedUserId === user.id || storedUserName === user.userName;
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
    const existing = await readSaiCliSsoAuthFile(filePath);
    const nextPayload = buildSaiCliSsoAuthPayload(user, existing);
    const nextContent = normalizeJsonFileContent(nextPayload);

    if (existing && normalizeJsonFileContent(existing) === nextContent) {
      logger.info('SAI CLI auth file already up to date', filePath);
      return;
    }

    logger.info('Sync SSO auth to SAI CLI', filePath);
    await writeFile(filePath, nextContent, 'utf-8');
  } catch (err) {
    logger.warn('Failed to sync SSO auth to ~/.sai/sso-auth.json:', err);
  }
}

/**
 * Remove ~/.sai/sso-auth.json on logout or token expiry.
 */
export async function removeSsoAuthFromSaiCli(user: SsoUserInfo | null = null): Promise<void> {
  try {
    const filePath = join(homedir(), '.sai', 'sso-auth.json');
    const existing = await readSaiCliSsoAuthFile(filePath);
    if (!existing) return;
    if (!shouldRemoveSaiCliSsoAuth(existing, user)) {
      logger.info('Preserve ~/.sai/sso-auth.json because it does not match the current StoClaw auth session');
      return;
    }
    logger.info('Remove SSO auth from SAI CLI', filePath);
    await unlink(filePath);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') return;
    logger.warn('Failed to remove ~/.sai/sso-auth.json:', err);
  }
}

/**
 * Remove ~/.stoclaw/openclaw/sso-auth.json on logout or token expiry.
 */
export async function removeSsoAuthFromOpenClaw(): Promise<void> {
  try {
    const filePath = join(getOpenClawConfigDir(), 'sso-auth.json');
    logger.info('Remove sso auth from openclaw', filePath);
    await unlink(filePath);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') return;
    logger.warn('Failed to remove ~/.stoclaw/openclaw/sso-auth.json:', err);
  }
}
