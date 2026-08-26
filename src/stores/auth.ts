/**
 * Auth State Store
 * Manages SSO authentication state.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { toast } from 'sonner';
import { hostApiFetch } from '@/lib/host-api';
import { fetchAccountSwitchOptions as requestAccountSwitchOptions, isAccountSwitchHostApiMissing, isAuthSessionCommitHostApiMissing, postAccountSwitchDirect } from '@/lib/account-switch-fetch';
import { getCurrentEnvConfig } from '../../shared/env-config';
import { setSiteDepartmentTypes } from '../../shared/site-user-utils';
import { normalizeSsoRoleCodes } from '../../shared/sso-roles';
import type { ClientSiteAccessCheckData } from '../../shared/client-site-access';

interface StoSyncResponse {
  success?: boolean;
  created?: string[];
  deleted?: string[];
  updated?: string[];
  defaultSet?: string | null;
  error?: string;
  legacyRepaired?: boolean;
  needsForcedGatewayRefresh?: boolean;
  fallbackModel?: string;
  notifyUi?: boolean;
  agentsRemapped?: number;
}

export type SsoEnvironment =
  | 'daily-external'
  | 'production-internal'
  | 'production-external'
  | 'pre-release'
  | 'local';

export interface SsoUserInfo {
  id: string;
  userName: string;
  realName: string;
  code: string;
  empCode: string;
  companyId: string;
  companyCode: string;
  companyName: string;
  departmentId: string;
  departmentCode: string;
  departmentName: string;
  categoryCode: string;
  isAdministrator: boolean;
  /** SSO 角色编码列表（getRoles=true 时由登录接口填充） */
  roles?: string[];
  loginMode: string;
  openId: string;
  signature: string;
  authenticatedAt: string;
  stoToken?: string;
  stoTokenExpiresAt?: string;
}

export interface AccountSwitchOption {
  code: string;
  label: string;
}

export type AccountSwitchOptionsStatus = 'idle' | 'loading' | 'loaded' | 'error';

// Re-export shared site-user and auth-mode utilities.
export { isSiteUser, setSiteDepartmentTypes, getSiteDepartmentTypes } from '../../shared/site-user-utils';
export {
  resolveAiResourceIsSite,
  resolveSessionIsSite,
  isHqDemoAsSite,
  type AuthMode,
} from '../../shared/auth-mode-utils';

export interface ClientSiteAccessDeniedInfo {
  allowed: boolean;
  clientCode?: string;
  categoryCode?: string | null;
  companyCode?: string | null;
  errCode?: string;
  errMessage?: string;
}

interface AuthState {
  isAuthenticated: boolean;
  /** True after init() has completed at least once. Used to prevent auth guard from firing before the main-process status check resolves. */
  isInitialized: boolean;
  user: SsoUserInfo | null;
  ssoEnvironment: SsoEnvironment;
  isLoggingIn: boolean;
  error: string | null;
  /** 客户端网点白名单校验未通过（登录或冷启动） */
  accessDenied: boolean;
  accessCheck: ClientSiteAccessDeniedInfo | null;
  /** 切换网点前保存的总部原账号（演示用） */
  impersonationOrigin: SsoUserInfo | null;
  accountSwitchOptions: AccountSwitchOption[];
  accountSwitchOptionsStatus: AccountSwitchOptionsStatus;
  /** Renderer Apollo `claw.site.department` cache; null until first fetch completes. */
  siteDepartmentTypes: string[] | null;

  // Actions
  init: () => Promise<void>;
  login: (environment?: SsoEnvironment) => Promise<void>;
  logout: () => Promise<void>;
  setSsoEnvironment: (env: SsoEnvironment) => Promise<void>;
  clearAccessDenied: () => void;
  loadAccountSwitchOptions: () => Promise<void>;
  switchToAccount: (targetCode: string) => Promise<void>;
  switchBackToOrigin: () => Promise<void>;
}

function showStoSyncErrorToasts(stoSync?: StoSyncResponse | null): void {
  if (!stoSync?.error) return;

  if (stoSync.error === 'empty-model-list') {
    toast.error('获取 STO 模型失败', {
      description: '远程模型列表为空，请检查网络连接或稍后手动重试',
    });
    return;
  }

  if (stoSync.error.startsWith('fetch-failed')) {
    toast.error('模型列表同步失败', {
      description: '无法获取远程模型列表，请检查网络连接后刷新重试',
    });
    return;
  }

  if (stoSync.error === 'no-token') {
    useAuthStore.setState({ isAuthenticated: false, user: null });
    return;
  }
}

function coerceSsoUserInfo(raw: Record<string, unknown>): SsoUserInfo {
  return {
    id: String(raw.id ?? ''),
    userName: String(raw.userName ?? ''),
    realName: String(raw.realName ?? ''),
    code: String(raw.code ?? ''),
    empCode: String(raw.empCode ?? ''),
    companyId: String(raw.companyId ?? ''),
    companyCode: String(raw.companyCode ?? ''),
    companyName: String(raw.companyName ?? ''),
    departmentId: String(raw.departmentId ?? ''),
    departmentCode: String(raw.departmentCode ?? ''),
    departmentName: String(raw.departmentName ?? ''),
    categoryCode: String(raw.categoryCode ?? ''),
    isAdministrator: Boolean(raw.isAdministrator),
    roles: normalizeSsoRoleCodes(raw.roles),
    loginMode: String(raw.loginMode ?? ''),
    openId: String(raw.openId ?? ''),
    signature: String(raw.signature ?? ''),
    authenticatedAt: String(raw.authenticatedAt ?? new Date().toISOString()),
    stoToken: typeof raw.stoToken === 'string' ? raw.stoToken : undefined,
    stoTokenExpiresAt: typeof raw.stoTokenExpiresAt === 'string' ? raw.stoTokenExpiresAt : undefined,
  };
}

async function commitAuthSessionToHost(payload: {
  user: SsoUserInfo;
  impersonationOrigin?: SsoUserInfo | null;
}): Promise<StoSyncResponse | undefined> {
  try {
    const data = await hostApiFetch<{
      success: boolean;
      stoSync?: StoSyncResponse;
      error?: string;
    }>('/api/auth/session/commit', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!data.success) {
      throw new Error(data.error || '会话同步失败');
    }
    return data.stoSync;
  } catch (error) {
    if (!isAuthSessionCommitHostApiMissing(error)) {
      throw error;
    }
    console.warn('[auth] session commit skipped: Host API route missing, sso-auth.json may be stale');
    return undefined;
  }
}

async function fetchRendererSiteDepartmentTypes(): Promise<string[]> {
  try {
    const res = await hostApiFetch<{ types?: string[] }>('/api/auth/site-department-types');
    return Array.isArray(res.types) ? res.types : [];
  } catch {
    return [];
  }
}

function applyRendererSiteDepartmentTypes(types: string[]): string[] {
  setSiteDepartmentTypes(types);
  return types;
}

async function refreshProviderSnapshot(): Promise<void> {
  try {
    const { useProviderStore } = await import('@/stores/providers');
    await useProviderStore.getState().refreshProviderSnapshot();
  } catch (error) {
    console.warn('[auth] Provider snapshot refresh failed:', error);
  }
}
function reloadAppAfterAccountSwitch(): void {
  // HQ ↔ site impersonation changes sidebar menus and home surfaces; reload re-inits all stores.
  window.location.reload();
}

async function syncStoModelsAndRefreshProviders(context: 'init' | 'login'): Promise<void> {
  const maxAttempts = 2;
  let lastResult: StoSyncResponse | undefined;

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await hostApiFetch<StoSyncResponse>('/api/sto-model-sync', { method: 'POST' });
        lastResult = result;
        if (result?.error) {
          const isRetryable = result.error.startsWith('fetch-failed');
          if (isRetryable && attempt < maxAttempts) {
            console.warn(`[auth] STO model sync attempt ${attempt} failed: ${result.error}; retrying in 3s`);
            await new Promise((resolve) => setTimeout(resolve, 3000));
            continue;
          }
          // 非重试错误或最后一次尝试 — 给用户提示
          if (result.error === 'empty-model-list') {
            toast.error('获取 STO 模型失败', {
              description: '远程模型列表为空，请检查网络连接或稍后手动重试',
            });
          } else if (result.error.startsWith('fetch-failed')) {
            toast.error('模型列表同步失败', {
              description: '无法获取远程模型列表，请检查网络连接后刷新重试',
            });
          }
          // no-token 由主进程 auth:token-expired 事件处理，这里也同步清理渲染层状态
          if (result.error === 'no-token') {
            useAuthStore.setState({ isAuthenticated: false, user: null });
          }
        }
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt < maxAttempts) {
          console.warn(`[auth] STO model sync attempt ${attempt} failed during ${context}; retrying in 3s: ${message}`);
          await new Promise((resolve) => setTimeout(resolve, 3000));
          continue;
        }
        console.error(`[auth] STO model sync failed during ${context}: ${message}`);
        toast.error('模型列表同步失败', { description: message });
      }
    }
  } finally {
    try {
      const { applyStoCatalogSyncToChatUi } = await import('@/lib/sync-workspace-default-to-chat');
      await applyStoCatalogSyncToChatUi({ fallbackModel: lastResult?.fallbackModel });
    } catch (error) {
      console.warn(
        `[auth] Chat UI catalog sync failed after ${context} STO sync attempt`,
        error,
      );
      try {
        const { useProviderStore } = await import('@/stores/providers');
        await useProviderStore.getState().refreshProviderSnapshot();
      } catch (refreshError) {
        console.warn(
          `[auth] Provider snapshot refresh failed after ${context} STO sync attempt`,
          refreshError,
        );
      }
    }
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      isAuthenticated: false,
      isInitialized: false,
      user: null,
      ssoEnvironment: getCurrentEnvConfig().ssoEnvironment as SsoEnvironment,
      isLoggingIn: false,
      error: null,
      accessDenied: false,
      accessCheck: null,
      impersonationOrigin: null,
      accountSwitchOptions: [],
      accountSwitchOptionsStatus: 'idle',
      siteDepartmentTypes: null,

      clearAccessDenied: () => {
        set({ accessDenied: false, accessCheck: null, error: null });
      },

      init: async () => {
        // Always reset transient UI state on init
        set({ isLoggingIn: false, error: null });
        try {
          const data = await hostApiFetch<{
            isAuthenticated: boolean;
            user: SsoUserInfo | null;
            ssoEnvironment: SsoEnvironment;
            impersonationOrigin?: SsoUserInfo | null;
            accessDenied?: boolean;
            error?: string;
            accessCheck?: ClientSiteAccessCheckData & {
              clientCode?: string;
              errCode?: string;
              errMessage?: string;
            };
          }>('/api/auth/status');
          if (data.accessDenied) {
            set({
              isAuthenticated: false,
              user: null,
              ssoEnvironment: data.ssoEnvironment,
              isInitialized: true,
              accessDenied: true,
              accessCheck: data.accessCheck
                ? {
                    allowed: data.accessCheck.allowed === true,
                    clientCode: data.accessCheck.clientCode ?? data.accessCheck.client_code,
                    categoryCode: data.accessCheck.categoryCode ?? null,
                    companyCode: data.accessCheck.companyCode ?? null,
                    errCode: data.accessCheck.errCode,
                    errMessage: data.accessCheck.errMessage ?? data.error,
                  }
                : null,
              error: data.error || '您的所属组织无权使用 StoClaw',
            });
            return;
          }
          let siteDepartmentTypes: string[] | null = null;
          if (data.isAuthenticated) {
            siteDepartmentTypes = applyRendererSiteDepartmentTypes(
              await fetchRendererSiteDepartmentTypes(),
            );
          }
          set({
            isAuthenticated: data.isAuthenticated,
            user: data.user,
            ssoEnvironment: data.ssoEnvironment,
            isInitialized: true,
            accessDenied: false,
            accessCheck: null,
            impersonationOrigin: data.impersonationOrigin ?? null,
            siteDepartmentTypes,
          });
          if (data.isAuthenticated) {
            // If already authenticated on startup, ensure STO models are synced and
            // the renderer's provider list is up-to-date. The main process runs its
            // own startup sync (index.ts), but the renderer may have fetched providers
            // before that sync completed. This call deduplicates safely against any
            // in-progress main-process sync.
            void syncStoModelsAndRefreshProviders('init');
            void get().loadAccountSwitchOptions();
            // Main process runs batched setup on startup; refresh UI provider list only.
            void refreshProviderSnapshot();
          }
        } catch {
          // Main-process unreachable — trust the renderer-persisted state as fallback.
          // Still mark as initialized so the auth guard can proceed.
          set({ isInitialized: true });
        }
      },

      login: async (environment?: SsoEnvironment) => {
        set({ isLoggingIn: true, error: null });
        const completeLogin = (user: SsoUserInfo, stoSync?: StoSyncResponse) => {
          set({
            isAuthenticated: true,
            user,
            isLoggingIn: false,
            error: null,
            accessDenied: false,
            accessCheck: null,
            accountSwitchOptions: [],
            accountSwitchOptionsStatus: 'idle',
            impersonationOrigin: null,
            siteDepartmentTypes: null,
          });

          // Site metadata is useful after navigation but is not part of the
          // authentication completion boundary.
          void fetchRendererSiteDepartmentTypes().then((types) => {
            if (get().isAuthenticated && get().user?.code === user.code) {
              set({ siteDepartmentTypes: applyRendererSiteDepartmentTypes(types) });
            }
          });

          showStoSyncErrorToasts(stoSync);
          void syncStoModelsAndRefreshProviders('login');
          void get().loadAccountSwitchOptions();
        };

        try {
          const env = environment || get().ssoEnvironment;
          const data = await hostApiFetch<{
            success: boolean;
            cancelled?: boolean;
            accessDenied?: boolean;
            user?: SsoUserInfo;
            error?: string;
            stoSync?: StoSyncResponse;
            accessCheck?: ClientSiteAccessCheckData & {
              clientCode?: string;
              errCode?: string;
              errMessage?: string;
            };
          }>('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ environment: env }),
          });

          if (data.accessDenied) {
            set({
              isAuthenticated: false,
              user: null,
              isLoggingIn: false,
              accessDenied: true,
              accessCheck: data.accessCheck
                ? {
                    allowed: data.accessCheck.allowed === true,
                    clientCode: data.accessCheck.clientCode ?? data.accessCheck.client_code,
                    categoryCode: data.accessCheck.categoryCode ?? null,
                    companyCode: data.accessCheck.companyCode ?? null,
                    errCode: data.accessCheck.errCode,
                    errMessage: data.accessCheck.errMessage ?? data.error,
                  }
                : null,
              error: data.error || '您的所属组织无权使用 StoClaw',
            });
            return;
          }

          if (data.success && data.user) {
            completeLogin(data.user, data.stoSync);
          } else {
            set({
              isLoggingIn: false,
              accessDenied: false,
              accessCheck: null,
              error: data.cancelled ? 'SSO_LOGIN_CANCELLED' : (data.error || 'Login failed'),
            });
          }
        } catch (err) {
          // The login response can be lost after Main has already persisted the
          // session. Reconcile once with the authoritative state before showing
          // a transport error or leaving the Login page pending.
          try {
            const recovered = await hostApiFetch<{
              isAuthenticated: boolean;
              user: SsoUserInfo | null;
            }>('/api/auth/status');
            if (recovered.isAuthenticated && recovered.user) {
              completeLogin(recovered.user);
              return;
            }
          } catch {
            // Preserve the original login error; recovery is best-effort.
          }
          set({
            isLoggingIn: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },

      logout: async () => {
        try {
          await hostApiFetch('/api/auth/logout', { method: 'POST' });
        } catch {
          // Always clear local state even if API call fails
        }
        set({
          isAuthenticated: false,
          user: null,
          error: null,
          accessDenied: false,
          accessCheck: null,
          impersonationOrigin: null,
          accountSwitchOptions: [],
          accountSwitchOptionsStatus: 'idle',
          siteDepartmentTypes: null,
        });
        setSiteDepartmentTypes(null);

        // Refresh provider list to reflect STO model cleanup
        void refreshProviderSnapshot();
      },

      loadAccountSwitchOptions: async () => {
        const { isAuthenticated, user, ssoEnvironment, accountSwitchOptionsStatus } = get();
        if ((!isAuthenticated && !user) || accountSwitchOptionsStatus === 'loading' || accountSwitchOptionsStatus === 'loaded') {
          return;
        }
        set({ accountSwitchOptionsStatus: 'loading' });
        try {
          const result = await requestAccountSwitchOptions(user, ssoEnvironment);
          set({
            accountSwitchOptions: result.options,
            accountSwitchOptionsStatus: 'loaded',
          });
        } catch {
          set({
            accountSwitchOptions: [],
            accountSwitchOptionsStatus: 'error',
          });
        }
      },

      switchToAccount: async (targetCode: string) => {
        const trimmed = targetCode.trim();
        if (!trimmed) return;
        try {
          let data: {
            success: boolean;
            user?: SsoUserInfo;
            impersonationOrigin?: SsoUserInfo | null;
            error?: string;
            stoSync?: StoSyncResponse;
          };
          let usedDirectFallback = false;

          try {
            data = await hostApiFetch<typeof data>('/api/auth/account-switch', {
              method: 'POST',
              body: JSON.stringify({ targetCode: trimmed }),
            });
          } catch (hostError) {
            if (!isAccountSwitchHostApiMissing(hostError, 'POST', '/api/auth/account-switch')) {
              throw hostError;
            }
            const { user, impersonationOrigin, ssoEnvironment } = get();
            if (!user?.stoToken) {
              throw hostError;
            }
            const originSnapshot = impersonationOrigin ?? user;
            if (!impersonationOrigin) {
              set({ impersonationOrigin: user });
            }
            try {
              const switched = coerceSsoUserInfo(
                await postAccountSwitchDirect(user, ssoEnvironment, trimmed),
              );
              if (!switched.stoToken) {
                throw new Error('切换响应缺少 stoToken', { cause: hostError });
              }
              usedDirectFallback = true;
              data = {
                success: true,
                user: switched,
                impersonationOrigin: originSnapshot,
              };
            } catch (directError) {
              if (!impersonationOrigin) {
                set({ impersonationOrigin: null });
              }
              throw directError;
            }
          }

          if (!data.success || !data.user) {
            throw new Error(data.error || '切换网点账号失败');
          }
          set({
            user: data.user,
            impersonationOrigin: data.impersonationOrigin ?? null,
          });

          const stoSync = usedDirectFallback
            ? await commitAuthSessionToHost({
                user: data.user,
                impersonationOrigin: data.impersonationOrigin ?? null,
              })
            : data.stoSync;
          showStoSyncErrorToasts(stoSync);
          reloadAppAfterAccountSwitch();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          toast.error('切换网点账号失败', { description: message });
          throw err;
        }
      },

      switchBackToOrigin: async () => {
        try {
          let data: {
            success: boolean;
            user?: SsoUserInfo;
            error?: string;
            stoSync?: StoSyncResponse;
          };
          let usedDirectFallback = false;

          try {
            data = await hostApiFetch<typeof data>('/api/auth/account-switch/back', { method: 'POST' });
          } catch (hostError) {
            if (!isAccountSwitchHostApiMissing(hostError, 'POST', '/api/auth/account-switch/back')) {
              throw hostError;
            }
            const origin = get().impersonationOrigin;
            if (!origin?.stoToken) {
              throw new Error('没有可恢复的总部账号', { cause: hostError });
            }
            usedDirectFallback = true;
            data = { success: true, user: origin };
          }

          if (!data.success || !data.user) {
            throw new Error(data.error || '切回总部账号失败');
          }
          set({
            user: data.user,
            impersonationOrigin: null,
            accountSwitchOptions: [],
            accountSwitchOptionsStatus: 'idle',
          });

          const stoSync = usedDirectFallback
            ? await commitAuthSessionToHost({
                user: data.user,
                impersonationOrigin: null,
              })
            : data.stoSync;
          showStoSyncErrorToasts(stoSync);
          reloadAppAfterAccountSwitch();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          toast.error('切回总部账号失败', { description: message });
          throw err;
        }
      },

      setSsoEnvironment: async (env: SsoEnvironment) => {
        set({ ssoEnvironment: env });
        void hostApiFetch('/api/auth/environment', {
          method: 'PUT',
          body: JSON.stringify({ environment: env }),
        }).catch(() => {});
      },
    }),
    {
      name: 'stoclaw-auth',
      partialize: (state) => ({
        // isInitialized is intentionally excluded — it must always start as false
        // so the auth guard waits for the main-process check on every launch.
        isAuthenticated: state.isAuthenticated,
        user: state.user,
        ssoEnvironment: state.ssoEnvironment,
        impersonationOrigin: state.impersonationOrigin,
      }),
    },
  ),
);
