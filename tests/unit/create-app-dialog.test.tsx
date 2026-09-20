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
        name: pageType === 'site' ? '标准 Site 模版' : '标准 Assets 模版',
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

    expect(screen.getByRole('button', { name: /Site/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('固定域名，发版不需要修改版本号')).toBeInTheDocument();
    expect(screen.getByText('内嵌子应用，发布后需依赖主应用访问')).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: /标准 Site 模版/ })).toBeInTheDocument();
  });

  it('submits the selected assets pageType', async () => {
    render(<CreateAppDialog open onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('比如：快递查询助手'), { target: { value: '资源应用' } });
    fireEvent.click(screen.getByRole('button', { name: /Assets/ }));

    await waitFor(() => expect(screen.getByRole('button', { name: '创建应用' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '创建应用' }));

    await waitFor(() => {
      expect(createUserAppMock).toHaveBeenCalledWith({
        name: '资源应用',
        description: '',
        parentDir: '/tmp/SClawApps',
        projectType: 'frontend',
        pageType: 'assets',
        templateId: 'assets-minimal',
        templateVersion: '1.0.0',
        templateSource: 'memory-center',
      });
    });
  });

  it('normalizes and submits an optional application description', async () => {
    render(<CreateAppDialog open onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('比如：快递查询助手'), { target: { value: '查询助手' } });
    fireEvent.change(screen.getByLabelText(/应用描述/), { target: { value: '  查询快递状态  ' } });

    await waitFor(() => expect(screen.getByRole('button', { name: '创建应用' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '创建应用' }));

    await waitFor(() => expect(createUserAppMock).toHaveBeenCalledWith(expect.objectContaining({
      name: '查询助手',
      description: '查询快递状态',
    })));
  });

  it('prevents submission when the description exceeds 200 characters', async () => {
    render(<CreateAppDialog open onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('比如：快递查询助手'), { target: { value: '查询助手' } });
    fireEvent.change(screen.getByLabelText(/应用描述/), { target: { value: '描'.repeat(201) } });

    expect(screen.getByText('应用描述不能超过 200 个字符')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建应用' })).toBeDisabled();
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
          name: pageType === 'site' ? '标准 Site 模版' : '标准 Assets 模版',
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
          name: pageType === 'site' ? '标准 Site 模版' : '标准 Assets 模版',
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

    expect(await screen.findByRole('option', { name: '标准 Site 模版 · 本地资源' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '标准 Site 模版 · Memory Center · v1.0.0' })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('比如：快递查询助手'), { target: { value: '本地模板应用' } });
    fireEvent.click(screen.getByRole('button', { name: '创建应用' }));

    await waitFor(() => expect(createUserAppMock).toHaveBeenCalledWith(expect.objectContaining({
      templateId: 'site-minimal',
      templateVersion: 'local',
      templateSource: 'local-resource',
    })));
  });

  it('lets site apps choose the local A2UI React template', async () => {
    listAppTemplatesMock.mockResolvedValueOnce({
      items: [
        {
          templateId: 'site-minimal',
          pageType: 'site',
          name: '标准 Site 模版',
          description: '本地调试模板',
          status: 'ACTIVE',
          isBuiltin: true,
          latestVersion: 'local',
          source: 'local-resource',
          createdAt: '',
          updatedAt: '',
        },
        {
          templateId: 'react-a2ui-template',
          pageType: 'site',
          name: 'A2UI React 站点',
          description: '公司 Vite 工程底座',
          status: 'ACTIVE',
          isBuiltin: true,
          latestVersion: 'local',
          source: 'local-resource',
          createdAt: '',
          updatedAt: '',
        },
      ],
      total: 2,
      pageNum: 1,
      pageSize: 100,
    });
    render(<CreateAppDialog open onClose={vi.fn()} />);

    const select = await screen.findByRole('combobox', { name: '应用模板' });
    expect(await screen.findByRole('option', { name: 'A2UI React 站点 · 本地资源' })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'local-resource:react-a2ui-template:local' } });
    fireEvent.change(screen.getByPlaceholderText('比如：快递查询助手'), { target: { value: 'A2UI 应用' } });
    fireEvent.click(screen.getByRole('button', { name: '创建应用' }));

    await waitFor(() => expect(createUserAppMock).toHaveBeenCalledWith(expect.objectContaining({
      pageType: 'site',
      templateId: 'react-a2ui-template',
      templateVersion: 'local',
      templateSource: 'local-resource',
    })));
  });

  it('hides 工程形态 and always creates a frontend app', async () => {
    listAppTemplatesMock.mockImplementation(async () => ({
      items: [
        {
          templateId: 'site-minimal',
          pageType: 'site',
          name: '标准 Site 模版',
          description: '平台内置最简模板',
          status: 'ACTIVE',
          isBuiltin: true,
          latestVersion: '1.0.0',
          createdAt: '2026-08-26T00:00:00Z',
          updatedAt: '2026-08-26T00:00:00Z',
        },
        {
          templateId: 'site-fullstack',
          pageType: 'site',
          name: '全栈 Site 模版',
          description: '前端 + 本地后端',
          status: 'ACTIVE',
          isBuiltin: true,
          latestVersion: 'local',
          source: 'local-resource',
          createdAt: '',
          updatedAt: '',
        },
      ],
      total: 2,
      pageNum: 1,
      pageSize: 100,
    }));
    render(<CreateAppDialog open onClose={vi.fn()} />);

    expect(screen.queryByText('工程形态')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /全栈应用/ })).not.toBeInTheDocument();
    expect(await screen.findByRole('option', { name: /标准 Site 模版/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /全栈 Site 模版/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('比如：快递查询助手'), { target: { value: '快递助手' } });
    fireEvent.click(screen.getByRole('button', { name: '创建应用' }));

    await waitFor(() => expect(createUserAppMock).toHaveBeenCalledWith(expect.objectContaining({
      projectType: 'frontend',
      templateId: 'site-minimal',
    })));
  });
});
