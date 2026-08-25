import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const mocks = vi.hoisted(() => ({
  startLogin: vi.fn(), parseJsonBody: vi.fn(), sendJson: vi.fn(), setAuthUser: vi.fn(),
  checkAccess: vi.fn(), runSetup: vi.fn(), loadConfig: vi.fn(), startPeriodicSync: vi.fn(),
  onUserAuthenticated: vi.fn(), getImpersonationOrigin: vi.fn(), loadSiteDepartmentTypes: vi.fn(),
}));

vi.mock('electron', () => ({ app: { getVersion: () => 'test' } }));
vi.mock('@electron/utils/sso-login', () => ({
  SsoLoginManager: class { startLogin(...args: unknown[]) { return mocks.startLogin(...args); } },
}));
vi.mock('@electron/utils/auth-store', () => ({
  getAuthState: vi.fn(), setAuthUser: (...args: unknown[]) => mocks.setAuthUser(...args),
  clearAuthUser: vi.fn(), getSsoEnvironment: vi.fn().mockResolvedValue('production-external'),
  setSsoEnvironment: vi.fn(), getStoToken: vi.fn(), removeSsoAuthFromOpenClaw: vi.fn(),
  getImpersonationOrigin: (...args: unknown[]) => mocks.getImpersonationOrigin(...args), setImpersonationOrigin: vi.fn(), clearImpersonationOrigin: vi.fn(),
}));
vi.mock('@electron/utils/sso-service', () => ({ getBaseUrl: vi.fn(), signOut: vi.fn() }));
vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => mocks.parseJsonBody(...args),
  sendJson: (...args: unknown[]) => mocks.sendJson(...args),
}));
vi.mock('@electron/services/providers/sto-model-sync', () => ({
  getStoModelSyncService: () => ({ startPeriodicSync: mocks.startPeriodicSync, setGatewayManager: vi.fn() }),
}));
vi.mock('@electron/services/auth-setup-orchestrator', () => ({
  runAuthenticatedSetup: (...args: unknown[]) => mocks.runSetup(...args),
}));
vi.mock('@electron/services/client-update-platform', () => ({ runPendingInstallReport: vi.fn() }));
vi.mock('@electron/services/user-skill-workspace', () => ({ activateUserWorkspace: vi.fn(), getCurrentActiveUserCode: vi.fn() }));
vi.mock('@electron/utils/openclaw-auth', () => ({ removeStoDynamicRoutePluginFromOpenClaw: vi.fn() }));
vi.mock('@electron/services/sto-apollo-config-service', () => ({
  loadSiteDepartmentTypes: (...args: unknown[]) => mocks.loadSiteDepartmentTypes(...args),
  loadClawInferenceRuntimeConfig: (...args: unknown[]) => mocks.loadConfig(...args),
  clearInferenceRuntimeConfigCache: vi.fn(), fetchHqBalanceApplyUrl: vi.fn(), DEFAULT_HQ_BALANCE_APPLY_URL: '',
}));
vi.mock('@electron/services/client-site-access-service', () => ({
  getClientSiteAccessService: () => ({ checkAccess: (...args: unknown[]) => mocks.checkAccess(...args) }),
}));
vi.mock('@electron/services/claude-context-sync', () => ({ syncClaudeDefaultContext: vi.fn() }));
vi.mock('@electron/services/account-switch-service', () => ({ fetchAccountSwitchOptions: vi.fn(), switchAccountViaMemoryCenter: vi.fn() }));
vi.mock('@electron/services/sto-auth-mode', () => ({ resolveAuthMode: vi.fn() }));
vi.mock('@electron/scheduled-tasks/scheduled-task-service', () => ({
  getScheduledTaskService: () => ({
    onUserAuthenticated: (...args: unknown[]) => mocks.onUserAuthenticated(...args),
    stopScheduler: vi.fn(),
  }),
}));

const user = {
  id: 'u1', userName: 'tester', realName: 'Tester', code: 'E1', empCode: 'E1',
  companyId: 'c1', companyCode: 'C1', companyName: 'Company', departmentId: 'd1',
  departmentCode: 'D1', departmentName: 'Department', categoryCode: 'HQ',
  isAdministrator: false, loginMode: 'sso', openId: 'o1', signature: '',
  authenticatedAt: new Date().toISOString(), stoToken: 'token',
};

describe('auth login completion boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.parseJsonBody.mockResolvedValue({ environment: 'production-external' });
    mocks.startLogin.mockResolvedValue(user);
    mocks.checkAccess.mockResolvedValue({ allowed: true });
    mocks.setAuthUser.mockResolvedValue(undefined);
    mocks.loadConfig.mockResolvedValue(undefined);
    mocks.getImpersonationOrigin.mockResolvedValue(null);
    mocks.onUserAuthenticated.mockReturnValue(undefined);
    mocks.loadSiteDepartmentTypes.mockResolvedValue([]);
  });

  it('responds without awaiting post-login setup', async () => {
    mocks.runSetup.mockReturnValue(new Promise(() => {}));
    const { handleAuthRoutes } = await import('@electron/api/routes/auth');
    await handleAuthRoutes(
      { method: 'POST' } as IncomingMessage, {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/auth/login'),
      { mainWindow: { isDestroyed: () => false }, gatewayManager: {} } as never,
    );
    expect(mocks.setAuthUser).toHaveBeenCalledWith(user);
    expect(mocks.sendJson).toHaveBeenCalledWith(expect.anything(), 200, { success: true, user });
    expect(mocks.startPeriodicSync).toHaveBeenCalledOnce();
    expect(mocks.onUserAuthenticated).toHaveBeenCalledWith('E1');
    await vi.waitFor(() => expect(mocks.runSetup).toHaveBeenCalledOnce());
  });

  it('session/commit notifies scheduled tasks after persisting user', async () => {
    mocks.parseJsonBody.mockResolvedValue({ user });
    mocks.runSetup.mockResolvedValue({ stoSync: { success: true } });
    const { handleAuthRoutes } = await import('@electron/api/routes/auth');
    await handleAuthRoutes(
      { method: 'POST' } as IncomingMessage, {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/auth/session/commit'),
      { gatewayManager: {} } as never,
    );
    expect(mocks.setAuthUser).toHaveBeenCalledWith(user);
    expect(mocks.onUserAuthenticated).toHaveBeenCalledWith('E1');
  });

  it('does not persist when access is denied', async () => {
    mocks.checkAccess.mockResolvedValue({ allowed: false, errMessage: 'denied' });
    const { handleAuthRoutes } = await import('@electron/api/routes/auth');
    await handleAuthRoutes(
      { method: 'POST' } as IncomingMessage, {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/auth/login'),
      { mainWindow: { isDestroyed: () => false }, gatewayManager: {} } as never,
    );
    expect(mocks.setAuthUser).not.toHaveBeenCalled();
    expect(mocks.sendJson).toHaveBeenCalledWith(
      expect.anything(), 200, expect.objectContaining({ success: false, accessDenied: true }),
    );
  });
});
