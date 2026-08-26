export const TOKEN_COOKIE_KEY = 'stoToken';
export const USER_STORAGE_KEY = 'sclaw.app.user';
export const ROLES_STORAGE_KEY = 'sclaw.app.roles';
export const MODULES_STORAGE_KEY = 'sclaw.app.modules';
export const LOGIN_CONTEXT_STORAGE_KEY = 'sclaw.app.loginContext';

const TOKEN_COOKIE_MAX_AGE_SEC = 7 * 24 * 60 * 60;

/** SSO UserInfo / exchange.userInfo 持久化字段（与用户中心文档对齐）。 */
export interface AppUser {
  id: string;
  name: string;
  userName?: string;
  realName?: string;
  nickName?: string;
  code?: string;
  empCode?: string;
  openId?: string;
  accountId?: string;
  companyId?: string;
  companyCode?: string;
  companyName?: string;
  categoryCode?: string;
  departmentId?: string;
  departmentCode?: string;
  departmentName?: string;
  isAdministrator?: boolean;
  ipAddress?: string;
  loginMode?: string;
  signature?: string;
  systemCode?: string;
  email?: string;
  avatar?: string;
}

/** userLogOnResult 中的组织/站点上下文。 */
export interface SsoLoginContext {
  returnUrl?: string;
  companyCode?: string;
  site?: boolean;
  contractArea?: boolean;
  center?: boolean;
}

export interface AuthSession {
  token: string;
  user: AppUser;
  roles?: unknown[];
  modules?: unknown[];
  loginContext?: SsoLoginContext;
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const pattern = new RegExp(`(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]*)`);
  const match = document.cookie.match(pattern);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string, maxAgeSec: number) {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSec}; SameSite=Lax`;
}

function clearCookie(name: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
}

function readJsonStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function readTokenCookie(): string | null {
  const token = readCookie(TOKEN_COOKIE_KEY)?.trim();
  return token || null;
}

export function writeTokenCookie(token: string) {
  writeCookie(TOKEN_COOKIE_KEY, token, TOKEN_COOKIE_MAX_AGE_SEC);
}

export function clearTokenCookie() {
  clearCookie(TOKEN_COOKIE_KEY);
}

export function readStoredUser(): AppUser | null {
  const parsed = readJsonStorage<AppUser>(USER_STORAGE_KEY);
  if (!parsed?.id || !parsed?.name) return null;
  return parsed;
}

export function readStoredRoles(): unknown[] | null {
  return readJsonStorage<unknown[]>(ROLES_STORAGE_KEY);
}

export function readStoredModules(): unknown[] | null {
  return readJsonStorage<unknown[]>(MODULES_STORAGE_KEY);
}

export function readStoredLoginContext(): SsoLoginContext | null {
  return readJsonStorage<SsoLoginContext>(LOGIN_CONTEXT_STORAGE_KEY);
}

/** token 写入 cookie；用户、角色、菜单模块等写入 localStorage。 */
export function persistSession(session: AuthSession) {
  writeTokenCookie(session.token);
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(session.user));

  if (session.roles?.length) {
    localStorage.setItem(ROLES_STORAGE_KEY, JSON.stringify(session.roles));
  } else {
    localStorage.removeItem(ROLES_STORAGE_KEY);
  }

  if (session.modules?.length) {
    localStorage.setItem(MODULES_STORAGE_KEY, JSON.stringify(session.modules));
  } else {
    localStorage.removeItem(MODULES_STORAGE_KEY);
  }

  if (session.loginContext && Object.keys(session.loginContext).length > 0) {
    localStorage.setItem(LOGIN_CONTEXT_STORAGE_KEY, JSON.stringify(session.loginContext));
  } else {
    localStorage.removeItem(LOGIN_CONTEXT_STORAGE_KEY);
  }
}

export function clearSession() {
  clearTokenCookie();
  localStorage.removeItem(USER_STORAGE_KEY);
  localStorage.removeItem(ROLES_STORAGE_KEY);
  localStorage.removeItem(MODULES_STORAGE_KEY);
  localStorage.removeItem(LOGIN_CONTEXT_STORAGE_KEY);
}

export function readStoredSession(): AuthSession | null {
  const token = readTokenCookie();
  const user = readStoredUser();
  if (!token || !user) return null;

  return {
    token,
    user,
    roles: readStoredRoles() ?? undefined,
    modules: readStoredModules() ?? undefined,
    loginContext: readStoredLoginContext() ?? undefined,
  };
}
