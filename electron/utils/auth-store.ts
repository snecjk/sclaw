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
  companyId: string;
  companyCode: string;
  companyName: string;
  departmentId: string;
  departmentCode: string;
  departmentName: string;
  categoryCode: string; // 用户类别编码：独立网点、承包区等
  isAdministrator: boolean;
  loginMode: string;
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
  impersonationOrigin?: SsoUserInfo | null;
}

type JsonObject = Record<string, unknown>;

const SYSTEM_CODE = 'sto_claw';
// Invalidates in-flight work created by a previous login, logout, or switch.
// This stays process-local because every launch establishes a fresh runtime session.
let authSessionGeneration = 0;

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

function getCompiledSsoEnvironment(): SsoEnvironment {
  return getCurrentEnvConfig().ssoEnvironment as SsoEnvironment;
}

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

type AuthenticatedUserListener = (user: SsoUserInfo) => void;
const authenticatedUserListeners = new Set<AuthenticatedUserListener>();

export function onAuthenticatedUserSet(listener: AuthenticatedUserListener): () => void {
  authenticatedUserListeners.add(listener);
  return () => authenticatedUserListeners.delete(listener);
}

async function getEffectiveSsoEnvironment(): Promise<SsoEnvironment> {
  const envConfig = getCurrentEnvConfig();
  const compiledEnv = envConfig.ssoEnvironment as SsoEnvironment;

  // Non-dev builds stay pinned to the compile-time environment to avoid
  // cross-install auth-store state sending test/staging builds to prod.
  if (!envConfig.isDevelopment) {
    return compiledEnv;
  }

  const store = await getAuthStore();
  return store.get('ssoEnvironment', compiledEnv) as SsoEnvironment;
}

export async function getAuthState(): Promise<AuthState> {
  // Primary: read from ~/.sai/sso-auth.json as the single source of truth
  const saiAuthPath = join(homedir(), '.sai', 'sso-auth.json');
  const saiAuth = await readSaiCliSsoAuthFile(saiAuthPath);
  const ssoEnvironment = await getEffectiveSsoEnvironment();
  
  if (saiAuth?.stoToken && saiAuth?.expiresAt) {
    const userInfo = isPlainObject(saiAuth.userInfo) ? saiAuth.userInfo : {};
    return {
      isAuthenticated: true,
      ssoEnvironment,
      user: {
        id: String(saiAuth.userId ?? ''),
        userName: String(userInfo.UserName ?? ''),
        realName: String(userInfo.RealName ?? ''),
        code: String(userInfo.Code ?? ''),
        empCode: String(userInfo.Code ?? ''),
        companyId: String(userInfo.CompanyId ?? ''),
        companyCode: String(userInfo.CompanyCode ?? ''),
        companyName: String(userInfo.CompanyName ?? ''),
        departmentId: String(userInfo.DepartmentId ?? ''),
        departmentCode: String(userInfo.DepartmentCode ?? ''),
        departmentName: String(userInfo.DepartmentName ?? ''),
        categoryCode: String(userInfo.CategoryCode ?? ''),
        isAdministrator: Boolean(userInfo.IsAdministrator ?? false),
        loginMode: String(userInfo.LoginMode ?? ''),
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
  const storedUser = store.get('user', null) as SsoUserInfo | null;
  if (storedUser?.stoToken && storedUser.stoTokenExpiresAt) {
    // Migrate to ~/.sai/sso-auth.json
    await syncSsoAuthToSaiCli(storedUser);
  }
  return {
    isAuthenticated: store.get('isAuthenticated', false),
    ssoEnvironment,
    user: storedUser,
    systemCode: store.get('systemCode', SYSTEM_CODE),
  };
}

export interface AuthSessionSnapshot {
  key: string;
}

/** Returns a non-loggable comparison key for async work tied to the current login. */
export async function getAuthSessionSnapshot(): Promise<AuthSessionSnapshot> {
  const [state, origin] = await Promise.all([getAuthState(), getImpersonationOrigin()]);
  const user = state.user;
  return {
    key: `${authSessionGeneration}:${state.ssoEnvironment}:${user?.id || user?.code || 'anonymous'}:${user?.stoToken ?? ''}:${origin?.id || origin?.code || ''}:${origin?.stoToken ?? ''}`,
  };
}

export async function isAuthSessionCurrent(snapshot: AuthSessionSnapshot): Promise<boolean> {
  return (await getAuthSessionSnapshot()).key === snapshot.key;
}

export async function setAuthUser(user: SsoUserInfo): Promise<void> {
  authSessionGeneration++;
  // Primary storage: ~/.sai/sso-auth.json
  await syncSsoAuthToSaiCli(user);
  
  // Cache: electron-store (for backward compatibility)
  const store = await getAuthStore();
  store.set('isAuthenticated', true);
  store.set('user', user);
  
  // Sync to OpenClaw plugin
  await syncSsoAuthToOpenClaw(user);

  for (const listener of authenticatedUserListeners) {
    try {
      listener(user);
    } catch (error) {
      logger.warn('[auth] Authenticated user listener failed:', error);
    }
  }
}

export async function clearAuthUser(): Promise<void> {
  authSessionGeneration++;
  const store = await getAuthStore();
  const previousUser = store.get('user', null) as SsoUserInfo | null;
  logger.info('Clear auth user...');
  store.set('isAuthenticated', false);
  store.set('user', null);
  store.set('impersonationOrigin', null);
  void import('../main/services/jsbridge/session-registry').then(({ destroyAllBridgeSessions }) => {
    destroyAllBridgeSessions('auth_logout');
  }).catch(() => {});
  await removeSsoAuthFromSaiCli(previousUser);
  await removeSsoAuthFromOpenClaw();
}

/**
 * 一次性强制重登：存量 sai 的 Code 曾是登录名，发版不会自动改写。
 * 键已 true 则跳过。以后别的 SSO 修复必须换新键名，勿复用。
 * 判定 / 清理抛异常时不打标（异常上抛），留给下次启动重试——clearAuth 幂等。
 */
export const SSO_CODE_FIELD_RELOGIN_DONE_KEY = 'ssoCodeFieldReloginDone';

export interface SsoCodeFieldReloginStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export async function ensureSsoCodeFieldReloginOnce(options?: {
  store?: SsoCodeFieldReloginStore;
  isLoggedIn?: () => Promise<boolean>;
  clearAuth?: () => Promise<void>;
}): Promise<{ skipped: boolean; cleared: boolean }> {
  const store = options?.store ?? (await getAuthStore());
  if (store.get(SSO_CODE_FIELD_RELOGIN_DONE_KEY) === true) {
    return { skipped: true, cleared: false };
  }
  let cleared = false;
  const loggedIn = options?.isLoggedIn
    ? await options.isLoggedIn()
    : (await getAuthState()).isAuthenticated;
  if (loggedIn) {
    await (options?.clearAuth ?? clearAuthUser)();
    cleared = true;
  }
  store.set(SSO_CODE_FIELD_RELOGIN_DONE_KEY, true);
  return { skipped: false, cleared };
}

export async function getImpersonationOrigin(): Promise<SsoUserInfo | null> {
  const store = await getAuthStore();
  return (store.get('impersonationOrigin', null) as SsoUserInfo | null) ?? null;
}

export async function setImpersonationOrigin(user: SsoUserInfo | null): Promise<void> {
  const store = await getAuthStore();
  store.set('impersonationOrigin', user);
}

export async function clearImpersonationOrigin(): Promise<void> {
  const store = await getAuthStore();
  store.set('impersonationOrigin', null);
}

export async function getSsoEnvironment(): Promise<SsoEnvironment> {
  return getEffectiveSsoEnvironment();
}

export async function setSsoEnvironment(env: SsoEnvironment): Promise<void> {
  const store = await getAuthStore();
  const compiledEnv = getCompiledSsoEnvironment();
  if (getCurrentEnvConfig().isDevelopment) {
    store.set('ssoEnvironment', env);
    return;
  }

  // Keep non-dev builds pinned to their compile-time environment.
  store.set('ssoEnvironment', compiledEnv);
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
      Code: user.code,
      CompanyId: user.companyId,
      CompanyCode: user.companyCode,
      CompanyName: user.companyName,
      DepartmentId: user.departmentId,
      DepartmentCode: user.departmentCode,
      DepartmentName: user.departmentName,
      CategoryCode: user.categoryCode,
      IsAdministrator: user.isAdministrator,
      LoginMode: user.loginMode,
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
