import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateAppDialog } from '@/components/more-apps/CreateAppDialog';

const createUserAppMock = vi.fn();

vi.mock('@/lib/app-dev-api', () => ({
  createUserApp: (...args: unknown[]) => createUserAppMock(...args),
  getAppDevEnvironment: vi.fn(async () => ({
    nodeRuntime: { state: 'ready', version: '22', receivedBytes: 0, totalBytes: 0 },
    gitAvailable: true,
    defaultParentDir: '/tmp/SClawApps',
  })),
  prepareAppDevEnvironment: vi.fn(async () => undefined),
}));

vi.mock('@/lib/session-catalog-api', () => ({
  pickProjectFolder: vi.fn(async () => null),
}));

vi.mock('@/stores/session-catalog', () => ({
  useSessionCatalogStore: { getState: () => ({ refreshWorkspaces: vi.fn(async () => undefined) }) },
}));

vi.mock('@/stores/app-dev-catalog', () => ({
  useAppDevCatalogStore: {
    getState: () => ({
      registerWorkspaceId: vi.fn(),
      refresh: vi.fn(async () => undefined),
    }),
  },
}));

vi.mock('@/stores/app-plaza-shell', () => ({
  useAppPlazaShellStore: {
    getState: () => ({ openOrFocusDevAppTab: vi.fn() }),
  },
}));

describe('CreateAppDialog application type', () => {
  beforeEach(() => {
    createUserAppMock.mockReset();
    createUserAppMock.mockResolvedValue({ workspaceId: 'ws-1', appPath: '/tmp/app', workspaceName: '测试应用' });
  });

  it('defaults to site and explains both publishing modes', async () => {
    render(<CreateAppDialog open onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: /独立站点/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('固定域名，发版不需要修改版本号')).toBeInTheDocument();
    expect(screen.getByText('可以申请自定义域名，发版需要修改版本号')).toBeInTheDocument();
  });

  it('submits the selected assets pageType', async () => {
    render(<CreateAppDialog open onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('比如：快递查询助手'), { target: { value: '资源应用' } });
    fireEvent.click(screen.getByRole('button', { name: /托管应用/ }));

    await waitFor(() => expect(screen.getByRole('button', { name: '创建应用' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '创建应用' }));

    await waitFor(() => {
      expect(createUserAppMock).toHaveBeenCalledWith({
        name: '资源应用',
        parentDir: '/tmp/SClawApps',
        projectType: 'frontend',
        pageType: 'assets',
      });
    });
  });
});
