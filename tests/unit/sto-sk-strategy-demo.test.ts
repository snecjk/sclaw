import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SsoUserInfo } from '@electron/utils/auth-store';

const mocks = vi.hoisted(() => ({
  resolveAuthMode: vi.fn(),
  getHqSkStrategy: vi.fn(),
  getSiteSkStrategy: vi.fn(),
  getDemoSkStrategy: vi.fn(),
  loadSiteDepartmentTypes: vi.fn(),
}));

vi.mock('@electron/services/sto-auth-mode', () => ({
  resolveAuthMode: mocks.resolveAuthMode,
}));

vi.mock('@electron/services/sto-hq-sk-strategy', () => ({
  getHqSkStrategy: mocks.getHqSkStrategy,
}));

vi.mock('@electron/services/sto-site-sk-strategy', () => ({
  getSiteSkStrategy: mocks.getSiteSkStrategy,
}));

vi.mock('@electron/services/sto-demo-sk-strategy', () => ({
  getDemoSkStrategy: mocks.getDemoSkStrategy,
}));

vi.mock('@electron/services/sto-apollo-config-service', () => ({
  loadSiteDepartmentTypes: mocks.loadSiteDepartmentTypes,
}));

import { setSiteDepartmentTypes } from '../../shared/site-user-utils';
import { resolveStrategy, resolveUserType } from '@electron/services/sto-sk-strategy';

const siteUser: SsoUserInfo = {
  id: '1',
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
  openId: 'oid',
  signature: 'sig',
  authenticatedAt: new Date().toISOString(),
};

describe('sto-sk-strategy demo mode', () => {
  const hqStrategy = { tag: 'hq' };
  const siteStrategy = { tag: 'site' };
  const demoStrategy = { tag: 'demo' };

  beforeEach(() => {
    vi.resetAllMocks();
    setSiteDepartmentTypes(['独立网点']);
    mocks.getHqSkStrategy.mockReturnValue(hqStrategy);
    mocks.getSiteSkStrategy.mockReturnValue(siteStrategy);
    mocks.getDemoSkStrategy.mockReturnValue(demoStrategy);
    mocks.loadSiteDepartmentTypes.mockResolvedValue(new Set(['独立网点']));
  });

  it('prefers DemoSkStrategy when auth mode is hq-demo-as-site', async () => {
    mocks.resolveAuthMode.mockResolvedValue('hq-demo-as-site');
    const strategy = await resolveStrategy(siteUser);
    expect(strategy).toBe(demoStrategy);
    expect(mocks.getSiteSkStrategy).not.toHaveBeenCalled();
  });

  it('uses SiteSkStrategy for native site login', async () => {
    mocks.resolveAuthMode.mockResolvedValue('native-site');
    const strategy = await resolveStrategy(siteUser);
    expect(strategy).toBe(siteStrategy);
  });

  it('maps DemoSkStrategy user type to hq for quota expansion', async () => {
    mocks.resolveAuthMode.mockResolvedValue('hq-demo-as-site');
    const userType = await resolveUserType(siteUser);
    expect(userType).toBe('hq');
  });
});
