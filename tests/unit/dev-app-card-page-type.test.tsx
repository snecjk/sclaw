import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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

import { DevAppCard } from '../../src/components/more-apps/DevAppCard';
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
    applicationId: `app-${pageType}`,
    previewUrl: 'https://preview.example.cn',
    pageType,
  };
}

describe('DevAppCard page type', () => {
  it('marks a Site app and keeps its browser entry', async () => {
    render(<DevAppCard app={app('site')} />);
    expect(screen.getByLabelText('应用类型：Site')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: '更多操作' }), {
      button: 0,
      ctrlKey: false,
    });
    expect(await screen.findByText('系统浏览器打开')).toBeInTheDocument();
  });

  it('marks an Assets app and omits the browser entry', () => {
    render(<DevAppCard app={app('assets')} />);
    expect(screen.getByLabelText('应用类型：Assets')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: '更多操作' }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.queryByText('系统浏览器打开')).not.toBeInTheDocument();
  });
});
