import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.hoisted(() => vi.fn());
const fetchAccountsMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/host-api', () => ({ hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args) }));
vi.mock('@/lib/account-switch-fetch', () => ({
  fetchAccountSwitchOptions: (...args: unknown[]) => fetchAccountsMock(...args),
  isAccountSwitchHostApiMissing: () => false,
  isAuthSessionCommitHostApiMissing: () => false,
  postAccountSwitchDirect: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { useAuthStore, type SsoUserInfo } from '@/stores/auth';

const user: SsoUserInfo = {
  id: 'u1', userName: 'tester', realName: 'Tester', code: 'E1', empCode: 'E1',
  companyId: 'c1', companyCode: 'C1', companyName: 'Company', departmentId: 'd1',
  departmentCode: 'D1', departmentName: 'Department', categoryCode: 'HQ',
  isAdministrator: false, loginMode: 'sso', openId: 'o1', signature: '',
  authenticatedAt: new Date().toISOString(), stoToken: 'token',
};

describe('auth login recovery', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fetchAccountsMock.mockResolvedValue([]);
    useAuthStore.setState({
      isAuthenticated: false, user: null, isLoggingIn: false, error: null,
      accessDenied: false, accessCheck: null, siteDepartmentTypes: null,
    });
  });

  it('recovers a committed session after the login response is lost', async () => {
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/auth/login') throw new Error('login response timed out');
      if (path === '/api/auth/status') return { isAuthenticated: true, user };
      if (path === '/api/auth/site-department-types') return { types: [] };
      if (path === '/api/auth/app-dev-whitelist-users') return { users: [] };
      if (path === '/api/sto-model-sync') return { success: true, created: [], updated: [], deleted: [] };
      if (path === '/api/auth/crm-week-report-policy') return { allowed: false };
      return { success: true };
    });

    await useAuthStore.getState().login('production-external');

    expect(useAuthStore.getState()).toMatchObject({
      isAuthenticated: true, user, isLoggingIn: false, error: null,
    });
    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/auth/status');
  });

  it('keeps the original error when recovery finds no session', async () => {
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/auth/login') throw new Error('network unavailable');
      if (path === '/api/auth/status') return { isAuthenticated: false, user: null };
      return { success: true };
    });

    await useAuthStore.getState().login('production-external');

    expect(useAuthStore.getState()).toMatchObject({
      isAuthenticated: false, user: null, isLoggingIn: false, error: 'network unavailable',
    });
  });
});
