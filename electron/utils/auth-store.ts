/**
 * SSO Authentication State Persistence
 * Separate electron-store instance for auth data, isolated from AppSettings.
 */

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
    ssoEnvironment: 'production-external',
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
  return {
    isAuthenticated: store.get('isAuthenticated', false),
    ssoEnvironment: store.get('ssoEnvironment', 'production-external'),
    user: store.get('user', null),
    systemCode: store.get('systemCode', SYSTEM_CODE),
  };
}

export async function setAuthUser(user: SsoUserInfo): Promise<void> {
  const store = await getAuthStore();
  store.set('isAuthenticated', true);
  store.set('user', user);
}

export async function clearAuthUser(): Promise<void> {
  const store = await getAuthStore();
  store.set('isAuthenticated', false);
  store.set('user', null);
}

export async function getSsoEnvironment(): Promise<SsoEnvironment> {
  const store = await getAuthStore();
  return store.get('ssoEnvironment', 'production-external');
}

export async function setSsoEnvironment(env: SsoEnvironment): Promise<void> {
  const store = await getAuthStore();
  store.set('ssoEnvironment', env);
}

/**
 * Get the stored StoToken (if present and not expired).
 */
export async function getStoToken(): Promise<string | null> {
  const store = await getAuthStore();
  const user = store.get('user', null) as SsoUserInfo | null;
  if (!user?.stoToken || !user.stoTokenExpiresAt) return null;
  if (new Date(user.stoTokenExpiresAt) <= new Date()) return null;
  return user.stoToken;
}
