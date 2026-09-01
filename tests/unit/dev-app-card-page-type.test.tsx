import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { fetchSkipLoginLinkMock, openExternalUrlMock, openInSclawBrowserMock } = vi.hoisted(() => ({
  fetchSkipLoginLinkMock: vi.fn(),
  openExternalUrlMock: vi.fn(),
  openInSclawBrowserMock: vi.fn(),
}));

vi.mock('@/lib/workflow-api', () => ({
  getWorkflowStoToken: () => 'sto-local-token',
}));

vi.mock('@/stores/app-plaza-shell', () => ({
  useAppPlazaShellStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    openOrFocusDevAppTab: vi.fn(),
    closeDevAppTabsByWorkspaceId: vi.fn(),
  }),
}));

vi.mock('@/stores/app-dev-catalog', () => ({
  useAppDevCatalogStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    unregisterWorkspaceId: vi.fn(),
    refresh: vi.fn(async () => undefined),
  }),
}));

vi.mock('@/stores/session-catalog', () => ({
  useSessionCatalogStore: { getState: () => ({ refreshWorkspaces: vi.fn() }) },
}));

vi.mock('@/lib/app-dev-api', () => ({
  cloneDevApp: vi.fn(),
  deleteDevApp: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({ invokeIpc: vi.fn() }));
vi.mock('@/lib/session-catalog-api', () => ({ pickProjectFolder: vi.fn() }));
vi.mock('@/lib/preview-url', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/preview-url')>();
  return { ...actual, openExternalUrl: openExternalUrlMock };
});
vi.mock('@/lib/open-sclaw-browser', () => ({
  openInSclawBrowser: openInSclawBrowserMock,
}));
vi.mock('@/lib/app-plaza-api', () => ({
  fetchAppPlazaSkipLoginLink: fetchSkipLoginLinkMock,
  appendSkipLoginReturnUrl: (skipLoginUrl: string, returnUrl: string) =>
    `${skipLoginUrl}&returnUrl=${encodeURIComponent(returnUrl)}`,
}));

import {
  DevAppCard,
  formatDevAppCardDesc,
} from '../../src/components/more-apps/DevAppCard';
import {
  buildAppPermissionsCallbackUrl,
  buildAppPermissionsUrl,
  buildDirectAppPermissionsLoginUrl,
} from '../../src/lib/app-permissions-url';
import type { DevAppSummary } from '../../src/lib/app-dev-api';

function app(pageType: 'site' | 'assets'): DevAppSummary {
  return {
    workspaceId: `ws-${pageType}`,
    name: `${pageType} app`,
    appPath: `/tmp/${pageType}`,
    projectType: 'frontend',
    createdAt: '2026-08-21T00:00:00.000Z',
    localReady: true,
    availability: 'local',
    appCode: `app_${pageType}`,
    previewUrl: 'https://preview.example.cn',
    pageType,
  };
}

describe('formatDevAppCardDesc', () => {
  it('combines page type with local / remote / imported state', () => {
    expect(formatDevAppCardDesc({
      pageType: 'site',
      localReady: true,
      availability: 'local',
    })).toBe('独立站点 · 本机可编辑');
    expect(formatDevAppCardDesc({
      pageType: 'assets',
      localReady: true,
      availability: 'local',
      source: 'imported',
    })).toBe('托管应用 · 本地导入');
    expect(formatDevAppCardDesc({
      pageType: 'site',
      localReady: false,
      availability: 'remote-only',
    })).toBe('独立站点 · 仅云端，需拉取到本地');
  });
});

describe('DevAppCard page type', () => {
  it('builds the permissions URL for each app environment group', () => {
    expect(buildAppPermissionsUrl('app_test', 'development')).toBe(
      'https://sclaw-test.sto.cn/apps/app_test/permissions',
    );
    expect(buildAppPermissionsUrl('app_test', 'test')).toBe(
      'https://sclaw-test.sto.cn/apps/app_test/permissions',
    );
    expect(buildAppPermissionsUrl('app_prod', 'staging')).toBe(
      'https://sclaw.sto.cn/apps/app_prod/permissions',
    );
    expect(buildAppPermissionsUrl('app_prod', 'production')).toBe(
      'https://sclaw.sto.cn/apps/app_prod/permissions',
    );
    expect(buildAppPermissionsUrl(
      'app_configured',
      'test',
      '/permissions?appId=app_configured&embed=1',
    )).toBe('https://sclaw-test.sto.cn/permissions?appId=app_configured&embed=1');
    expect(buildAppPermissionsUrl(
      'app_configured',
      'test',
      'https://sclaw-test.sto.cn/permissions?appId=app_configured&embed=1#roles',
    )).toBe('https://sclaw-test.sto.cn/permissions?appId=app_configured&embed=1#roles');
    expect(buildAppPermissionsCallbackUrl(
      'https://sclaw-test.sto.cn/permissions?appId=app_configured&embed=1',
    )).toBe(
      'https://sclaw-test.sto.cn/sso/callback?redirect=%2Fpermissions%3FappId%3Dapp_configured%26embed%3D1',
    );
    expect(buildDirectAppPermissionsLoginUrl(
      'http://localhost:5174/sso/callback?redirect=%2Fpermissions%3FappId%3Dapp_configured',
      'sto-local-token',
    )).toBe(
      'http://localhost:5174/sso/callback?redirect=%2Fpermissions%3FappId%3Dapp_configured&stoToken=sto-local-token',
    );
  });

  it('opens the local permissions page with the current StoToken without remote SSO', async () => {
    fetchSkipLoginLinkMock.mockResolvedValue(
      'https://page-test.sto.cn/sto-base-service/sto-sso-web/#/main?autoLogin=true&ticket=t-1',
    );
    render(<DevAppCard app={app('site')} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: '更多操作' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByText('权限配置'));
    await waitFor(() => {
      expect(fetchSkipLoginLinkMock).not.toHaveBeenCalled();
      expect(openInSclawBrowserMock).toHaveBeenCalledWith({
        url: 'https://sclaw-test.sto.cn/sso/callback?redirect=%2Fapps%2Fapp_site%2Fpermissions&stoToken=sto-local-token',
        title: 'site app · 权限配置',
        appId: 'dev-app-permissions:app_site',
        sourceUrl: 'https://sclaw-test.sto.cn/sso/callback?redirect=%2Fapps%2Fapp_site%2Fpermissions',
        systemCode: 'SCLAW_PORTAL',
        skipLoginEligible: false,
      });
    });
    expect(openExternalUrlMock).not.toHaveBeenCalled();
  });

  it('marks a Site app and keeps its browser entry', async () => {
    render(<DevAppCard app={app('site')} />);
    expect(screen.getByLabelText('应用类型：独立站点')).toHaveClass('more-apps-card__icon--dev');
    expect(screen.getByLabelText('应用类型：独立站点')).toHaveTextContent('s');
    expect(screen.getByText('独立站点 · 本机可编辑')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: '更多操作' }), {
      button: 0,
      ctrlKey: false,
    });
    expect(await screen.findByText('系统浏览器打开')).toBeInTheDocument();
  });

  it('marks an Assets app and omits the browser entry', () => {
    render(<DevAppCard app={app('assets')} />);
    expect(screen.getByLabelText('应用类型：托管应用')).toHaveClass('more-apps-card__icon--dev');
    expect(screen.getByLabelText('应用类型：托管应用')).toHaveTextContent('a');
    expect(screen.getByText('托管应用 · 本机可编辑')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: '更多操作' }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.queryByText('系统浏览器打开')).not.toBeInTheDocument();
  });

  it('shows delete for cloud-only apps with appCode', async () => {
    render(<DevAppCard app={{
      workspaceId: '',
      name: 'remote app',
      appPath: '',
      projectType: 'frontend',
      createdAt: '2026-08-21T00:00:00.000Z',
      localReady: false,
      availability: 'remote-only',
      appCode: 'app_remote',
      pageType: 'site',
    }} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: '更多操作' }), {
      button: 0,
      ctrlKey: false,
    });
    expect(await screen.findByText('删除应用')).toBeInTheDocument();
    expect(screen.getByText('独立站点 · 仅云端，需拉取到本地')).toBeInTheDocument();
  });
});
