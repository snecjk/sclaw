import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CREATE_OWNED_DATASOURCE_URL } from '@/pages/DataCenter/data-manage/constants';
import {
  buildPreviewAuthInjectScript,
  resolveCreateOwnedDatasourceEmbed,
  resolveDataManagePreviewEmbed,
} from '@/pages/DataCenter/data-manage/create-owned-sso';

const fetchAppPlazaSkipLoginLinkMock = vi.fn();
const fetchFinanceBiPreviewEmbedAuthMock = vi.fn();

vi.mock('@/lib/app-plaza-api', () => ({
  fetchAppPlazaSkipLoginLink: (...args: unknown[]) => fetchAppPlazaSkipLoginLinkMock(...args),
  appendSkipLoginReturnUrl: (skipLoginUrl: string, returnUrl: string) =>
    `${skipLoginUrl}&returnUrl=${encodeURIComponent(returnUrl)}`,
}));

vi.mock('@/lib/finance-bi-api', () => ({
  fetchFinanceBiPreviewEmbedAuth: (...args: unknown[]) => fetchFinanceBiPreviewEmbedAuthMock(...args),
  fetchFinanceBiPreviewEmbedBridge: async () => undefined,
}));

describe('resolveDataManagePreviewEmbed', () => {
  beforeEach(() => {
    fetchAppPlazaSkipLoginLinkMock.mockReset();
    fetchFinanceBiPreviewEmbedAuthMock.mockReset();
  });

  it('opens the target page directly when BI token is still valid', async () => {
    const injectAuth = {
      token: 'bi-token',
      sid: 'sid-1',
      userInfo: { name: 'sll' },
      stoBiUserInfo: { StoToken: 'bi-token' },
      exp: 1_800_000_000_000,
      time: 1_700_000_000_000,
    };
    fetchFinanceBiPreviewEmbedAuthMock.mockResolvedValue(injectAuth);

    await expect(resolveCreateOwnedDatasourceEmbed()).resolves.toEqual({
      url: CREATE_OWNED_DATASOURCE_URL,
      injectAuth,
    });
    expect(CREATE_OWNED_DATASOURCE_URL).toContain('source=sclaw');
    expect(fetchAppPlazaSkipLoginLinkMock).not.toHaveBeenCalled();
  });

  it('falls back to skip-login only when BI token is unavailable', async () => {
    fetchFinanceBiPreviewEmbedAuthMock.mockRejectedValue(new Error('财务 BI 登录态无效'));
    fetchAppPlazaSkipLoginLinkMock.mockResolvedValue(
      'https://page.sto.cn/sto-base-service/sto-sso-web/#/main?code=ticket-1',
    );

    const previewUrl = 'https://page.sto.cn/ux/sto-finance-bi-preview/index.html#/data-model/create?source=sclaw';
    await expect(resolveDataManagePreviewEmbed(previewUrl)).resolves.toEqual({
      url: `https://page.sto.cn/sto-base-service/sto-sso-web/#/main?code=ticket-1&returnUrl=${encodeURIComponent(previewUrl)}`,
    });
    expect(fetchAppPlazaSkipLoginLinkMock).toHaveBeenCalledWith('sto-finance-bi');
  });
});

describe('buildPreviewAuthInjectScript', () => {
  it('writes preview localStorage keys used by x-bi-token', () => {
    const script = buildPreviewAuthInjectScript({
      token: 'bi-token',
      sid: 'sid-1',
      userInfo: { name: 'sll' },
      stoBiUserInfo: { StoToken: 'bi-token' },
      exp: 99,
      time: 11,
    });
    expect(script).toContain("localStorage.setItem('auth.token'");
    expect(script).toContain('bi-token');
    expect(script).toContain("localStorage.setItem('auth.sid'");
    expect(script).toContain('sid-1');
  });
});
