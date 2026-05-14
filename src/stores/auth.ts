/**
 * Auth State Store
 * Manages SSO authentication state.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { hostApiFetch } from '@/lib/host-api';
import { getCurrentEnvConfig } from '../../shared/env-config';

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
  companyName: string;
  departmentName: string;
  openId: string;
  signature: string;
  authenticatedAt: string;
  stoToken?: string;
  stoTokenExpiresAt?: string;
}

export type CrmWeekReportPolicyStatus = 'idle' | 'loading' | 'ok' | 'error';

interface AuthState {
  isAuthenticated: boolean;
  /** True after init() has completed at least once. Used to prevent auth guard from firing before the main-process status check resolves. */
  isInitialized: boolean;
  user: SsoUserInfo | null;
  ssoEnvironment: SsoEnvironment;
  isLoggingIn: boolean;
  error: string | null;
  /** CRM 周报首页 /tasks 表面：仅在为 true 时展示（策略白名单命中）；未登录或 fail-closed 时为 false。 */
  crmWeekReportSurfaceAllowed: boolean;
  crmWeekReportPolicyStatus: CrmWeekReportPolicyStatus;

  // Actions
  init: () => Promise<void>;
  login: (environment?: SsoEnvironment) => Promise<void>;
  logout: () => Promise<void>;
  setSsoEnvironment: (env: SsoEnvironment) => Promise<void>;
  refreshCrmWeekReportPolicy: () => Promise<void>;
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
      crmWeekReportSurfaceAllowed: false,
      crmWeekReportPolicyStatus: 'idle',

      refreshCrmWeekReportPolicy: async () => {
        const { isAuthenticated, user } = get();
        if (!isAuthenticated || !user?.userName?.trim()) {
          set({
            crmWeekReportSurfaceAllowed: false,
            crmWeekReportPolicyStatus: 'idle',
          });
          return;
        }
        set({ crmWeekReportPolicyStatus: 'loading' });
        try {
          const data = await hostApiFetch<{ allowed: boolean }>('/api/auth/crm-week-report-policy');
          set({
            crmWeekReportSurfaceAllowed: data.allowed === true,
            crmWeekReportPolicyStatus: 'ok',
          });
        } catch {
          set({
            crmWeekReportSurfaceAllowed: false,
            crmWeekReportPolicyStatus: 'error',
          });
        }
      },

      init: async () => {
        // Always reset transient UI state on init
        set({ isLoggingIn: false, error: null });
        try {
          const data = await hostApiFetch<{
            isAuthenticated: boolean;
            user: SsoUserInfo | null;
            ssoEnvironment: SsoEnvironment;
          }>('/api/auth/status');
          set({
            isAuthenticated: data.isAuthenticated,
            user: data.user,
            ssoEnvironment: data.ssoEnvironment,
            isInitialized: true,
          });
          if (!data.isAuthenticated) {
            set({
              crmWeekReportSurfaceAllowed: false,
              crmWeekReportPolicyStatus: 'idle',
            });
          } else {
            void get().refreshCrmWeekReportPolicy();
            // If already authenticated on startup, ensure STO models are synced and
            // the renderer's provider list is up-to-date. The main process runs its
            // own startup sync (index.ts), but the renderer may have fetched providers
            // before that sync completed. This call deduplicates safely against any
            // in-progress main-process sync.
            void hostApiFetch('/api/sto-model-sync', { method: 'POST' })
              .then(() => import('@/stores/providers'))
              .then(({ useProviderStore }) =>
                useProviderStore.getState().refreshProviderSnapshot(),
              )
              .catch(() => {});
          }
        } catch {
          // Main-process unreachable — trust the renderer-persisted state as fallback.
          // Still mark as initialized so the auth guard can proceed.
          set({
            isInitialized: true,
            crmWeekReportSurfaceAllowed: false,
            crmWeekReportPolicyStatus: 'idle',
          });
        }
      },

      login: async (environment?: SsoEnvironment) => {
        set({ isLoggingIn: true, error: null });
        try {
          const env = environment || get().ssoEnvironment;
          const data = await hostApiFetch<{
            success: boolean;
            cancelled?: boolean;
            user?: SsoUserInfo;
            error?: string;
          }>('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ environment: env }),
          });

          if (data.success && data.user) {
            set({
              isAuthenticated: true,
              user: data.user,
              isLoggingIn: false,
              error: null,
            });

            // Trigger STO model sync and refresh provider list in UI
            void hostApiFetch('/api/sto-model-sync', { method: 'POST' })
              .then(() => import('@/stores/providers'))
              .then(({ useProviderStore }) =>
                useProviderStore.getState().refreshProviderSnapshot(),
              )
              .catch(() => {});

            void get().refreshCrmWeekReportPolicy();
          } else {
            set({
              isLoggingIn: false,
              error: data.cancelled ? 'SSO_LOGIN_CANCELLED' : (data.error || 'Login failed'),
            });
          }
        } catch (err) {
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
          crmWeekReportSurfaceAllowed: false,
          crmWeekReportPolicyStatus: 'idle',
        });

        // Refresh provider list to reflect STO model cleanup
        void import('@/stores/providers').then(({ useProviderStore }) =>
          useProviderStore.getState().refreshProviderSnapshot(),
        ).catch(() => {});
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
      }),
    },
  ),
);
