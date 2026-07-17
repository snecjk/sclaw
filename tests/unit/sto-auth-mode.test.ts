import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SsoUserInfo } from '@electron/utils/auth-store';

const mocks = vi.hoisted(() => ({
  getAuthState: vi.fn(),
  getImpersonationOrigin: vi.fn(),
  getStoToken: vi.fn(),
}));

vi.mock('@electron/utils/auth-store', () => ({
  getAuthState: mocks.getAuthState,
  getImpersonationOrigin: mocks.getImpersonationOrigin,
  getStoToken: mocks.getStoToken,
}));

import {
  getAiResourceStoToken,
  resolveAiResourceContext,
  resolveAuthMode,
} from '@electron/services/sto-auth-mode';
import { setSiteDepartmentTypes } from '../../shared/site-user-utils';

const sessionSite: SsoUserInfo = {
  id: '2',
  userName: 'site',
  realName: 'Site',
  code: 'site001',
  empCode: 'site001',
  companyId: 'c1',
  companyCode: 'C001',
  companyName: 'Site Co',
  departmentId: 'd1',
  departmentCode: 'D001',
  departmentName: 'Dept',
  categoryCode: '独立网点',
  isAdministrator: false,
  loginMode: 'sso',
  openId: 'oid2',
  signature: 'sig',
  authenticatedAt: new Date().toISOString(),
  stoToken: 'site-token',
};

const originHq: SsoUserInfo = {
  ...sessionSite,
  id: '1',
  code: 'hq001',
  categoryCode: '总部',
  stoToken: 'hq-token',
  stoTokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
};

describe('sto-auth-mode', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setSiteDepartmentTypes(['独立网点']);
  });

  it('resolveAuthMode returns hq-demo-as-site when origin is set', async () => {
    mocks.getAuthState.mockResolvedValue({ user: sessionSite });
    mocks.getImpersonationOrigin.mockResolvedValue(originHq);
    await expect(resolveAuthMode()).resolves.toBe('hq-demo-as-site');
  });

  it('resolveAiResourceContext uses origin user and token in demo mode', async () => {
    mocks.getAuthState.mockResolvedValue({ user: sessionSite });
    mocks.getImpersonationOrigin.mockResolvedValue(originHq);

    const ctx = await resolveAiResourceContext();
    expect(ctx?.mode).toBe('hq-demo-as-site');
    expect(ctx?.sessionUser.code).toBe('site001');
    expect(ctx?.aiUser.code).toBe('hq001');
    expect(ctx?.aiStoToken).toBe('hq-token');
  });

  it('getAiResourceStoToken returns session token for native login', async () => {
    mocks.getAuthState.mockResolvedValue({ user: { ...sessionSite, categoryCode: '总部' } });
    mocks.getImpersonationOrigin.mockResolvedValue(null);
    mocks.getStoToken.mockResolvedValue('session-token');

    await expect(getAiResourceStoToken()).resolves.toBe('session-token');
  });
});
