import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  validate: vi.fn(),
  getAuthState: vi.fn(),
  sendJson: vi.fn(),
}));

vi.mock('@electron/services/sso-auth-local-session', () => ({
  validateSsoAuthLocalSession: (...args: unknown[]) => mocks.validate(...args),
}));
vi.mock('@electron/utils/auth-store', () => ({
  getAuthState: (...args: unknown[]) => mocks.getAuthState(...args),
}));
vi.mock('@electron/api/route-utils', () => ({
  sendJson: (...args: unknown[]) => mocks.sendJson(...args),
}));

function request(headers: Record<string, string> = {}): IncomingMessage {
  return { method: 'POST', headers } as IncomingMessage;
}

const session = {
  workspaceId: 'ws-1',
  appPath: '/tmp/app',
  applicationId: 'app-1',
  pageType: 'site',
  secret: 'session-secret',
  expiresAt: Date.now() + 60_000,
};

const user = {
  id: 'u-1',
  userName: 'tester',
  realName: '测试用户',
  code: 'W001',
  empCode: 'E001',
  companyId: 'c-1',
  companyCode: 'C001',
  companyName: '公司',
  departmentId: 'd-1',
  departmentCode: 'D001',
  departmentName: '部门',
  categoryCode: 'HQ',
  isAdministrator: false,
  loginMode: 'sso',
  openId: 'open-1',
  signature: '',
  authenticatedAt: new Date().toISOString(),
  stoToken: 'token-a',
  stoTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
};

describe('local SSO Auth Bootstrap route', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.validate.mockReturnValue(session);
    mocks.getAuthState.mockResolvedValue({ isAuthenticated: true, user });
  });

  it('rejects an invalid session before reading authentication state', async () => {
    mocks.validate.mockReturnValue(null);
    const { handleAppDevSsoAuthRoute } = await import('@electron/api/routes/app-dev-sso-auth');

    await handleAppDevSsoAuthRoute(
      request({
        'x-sto-sso-auth-workspace': 'ws-1',
        'x-sto-sso-auth-session': 'wrong',
      }),
      {} as ServerResponse,
      new URL('http://127.0.0.1/api/app-dev/sso-auth/bootstrap'),
    );

    expect(mocks.getAuthState).not.toHaveBeenCalled();
    expect(mocks.sendJson).toHaveBeenCalledWith(expect.anything(), 403, {
      success: false,
      error: 'LOCAL_AUTH_SESSION_DENIED',
    });
  });

  it('returns only the normalized current identity for a valid Site session', async () => {
    const { handleAppDevSsoAuthRoute } = await import('@electron/api/routes/app-dev-sso-auth');
    await handleAppDevSsoAuthRoute(
      request({
        'x-sto-sso-auth-workspace': 'ws-1',
        'x-sto-sso-auth-session': 'session-secret',
      }),
      {} as ServerResponse,
      new URL('http://127.0.0.1/api/app-dev/sso-auth/bootstrap'),
    );

    expect(mocks.sendJson).toHaveBeenCalledWith(expect.anything(), 200, {
      success: true,
      token: 'token-a',
      user: {
        userId: 'u-1',
        userCode: 'W001',
        userName: '测试用户',
      },
    });
    expect(JSON.stringify(mocks.sendJson.mock.calls)).not.toContain('session-secret');
    expect(JSON.stringify(mocks.sendJson.mock.calls)).not.toContain('stoTokenExpiresAt');
  });

  it('rejects Assets sessions and expired authentication', async () => {
    const { handleAppDevSsoAuthRoute } = await import('@electron/api/routes/app-dev-sso-auth');
    mocks.validate.mockReturnValue({ ...session, pageType: 'assets' });
    await handleAppDevSsoAuthRoute(
      request({
        'x-sto-sso-auth-workspace': 'ws-1',
        'x-sto-sso-auth-session': 'session-secret',
      }),
      {} as ServerResponse,
      new URL('http://127.0.0.1/api/app-dev/sso-auth/bootstrap'),
    );
    expect(mocks.sendJson).toHaveBeenLastCalledWith(expect.anything(), 403, {
      success: false,
      error: 'SSO_AUTH_PAGE_TYPE_UNSUPPORTED',
    });

    mocks.validate.mockReturnValue(session);
    mocks.getAuthState.mockResolvedValue({
      isAuthenticated: true,
      user: { ...user, stoTokenExpiresAt: new Date(Date.now() - 1).toISOString() },
    });
    await handleAppDevSsoAuthRoute(
      request({
        'x-sto-sso-auth-workspace': 'ws-1',
        'x-sto-sso-auth-session': 'session-secret',
      }),
      {} as ServerResponse,
      new URL('http://127.0.0.1/api/app-dev/sso-auth/bootstrap'),
    );
    expect(mocks.sendJson).toHaveBeenLastCalledWith(expect.anything(), 401, {
      success: false,
      error: 'AUTH_REQUIRED',
    });
  });
});
