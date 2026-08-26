import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateAppDialog } from '@/components/more-apps/CreateAppDialog';

const createUserAppMock = vi.fn();
const listAppTemplatesMock = vi.fn();

vi.mock('@/lib/app-dev-api', () => ({
  createUserApp: (...args: unknown[]) => createUserAppMock(...args),
  listAppTemplates: (...args: unknown[]) => listAppTemplatesMock(...args),
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
    listAppTemplatesMock.mockReset();
    createUserAppMock.mockResolvedValue({ workspaceId: 'ws-1', appPath: '/tmp/app', workspaceName: '测试应用' });
    listAppTemplatesMock.mockImplementation(async (pageType: 'site' | 'assets') => ({
      items: [{
        templateId: `${pageType}-minimal`,
        pageType,
        name: pageType === 'site' ? '最简独立站点' : '最简托管应用',
        description: '平台内置最简模板',
        status: 'ACTIVE',
        isBuiltin: true,
        latestVersion: '1.0.0',
        createdAt: '2026-08-26T00:00:00Z',
        updatedAt: '2026-08-26T00:00:00Z',
      }],
      total: 1,
      pageNum: 1,
      pageSize: 100,
    }));
  });

  it('defaults to site and explains both publishing modes', async () => {
    render(<CreateAppDialog open onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: /独立站点/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('固定域名，发版不需要修改版本号')).toBeInTheDocument();
    expect(screen.getByText('可以申请自定义域名，发版需要修改版本号')).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: /最简独立站点/ })).toBeInTheDocument();
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
        templateId: 'assets-minimal',
        templateVersion: '1.0.0',
        templateSource: 'memory-center',
      });
    });
  });

  it('does not silently select another template when minimal is not initialized', async () => {
    listAppTemplatesMock.mockResolvedValueOnce({
      items: [{
        templateId: '01J00000000000000000000000',
        pageType: 'site',
        name: '业务模板',
        description: '',
        status: 'ACTIVE',
        isBuiltin: false,
        latestVersion: '1.0.0',
        createdAt: '2026-08-26T00:00:00Z',
        updatedAt: '2026-08-26T00:00:00Z',
      }],
      total: 1,
      pageNum: 1,
      pageSize: 100,
    });
    render(<CreateAppDialog open onClose={vi.fn()} />);

    expect(await screen.findByText('内置最简模板尚未初始化，请主动选择其他模板')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '应用模板' })).toHaveValue('');
    expect(screen.getByRole('option', { name: '请选择模板' })).toBeInTheDocument();
  });

  it('distinguishes a local resource template from the Memory Center version', async () => {
    listAppTemplatesMock.mockImplementation(async (pageType: 'site' | 'assets') => ({
      items: [
        {
          templateId: `${pageType}-minimal`,
          pageType,
          name: pageType === 'site' ? '最简独立站点' : '最简托管应用',
          description: '本地调试模板',
          status: 'ACTIVE',
          isBuiltin: true,
          latestVersion: 'local',
          source: 'local-resource',
          createdAt: '',
          updatedAt: '',
        },
        {
          templateId: `${pageType}-minimal`,
          pageType,
          name: pageType === 'site' ? '最简独立站点' : '最简托管应用',
          description: '平台内置最简模板',
          status: 'ACTIVE',
          isBuiltin: true,
          latestVersion: '1.0.0',
          source: 'memory-center',
          createdAt: '2026-08-26T00:00:00Z',
          updatedAt: '2026-08-26T00:00:00Z',
        },
      ],
      total: 2,
      pageNum: 1,
      pageSize: 100,
    }));
    render(<CreateAppDialog open onClose={vi.fn()} />);

    expect(await screen.findByRole('option', { name: '最简独立站点 · 本地资源' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '最简独立站点 · Memory Center · v1.0.0' })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('比如：快递查询助手'), { target: { value: '本地模板应用' } });
    fireEvent.click(screen.getByRole('button', { name: '创建应用' }));

    await waitFor(() => expect(createUserAppMock).toHaveBeenCalledWith(expect.objectContaining({
      templateId: 'site-minimal',
      templateVersion: 'local',
      templateSource: 'local-resource',
    })));
  });
});
