import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppTemplateManagerDialog } from '@/components/more-apps/AppTemplateManagerDialog';

const listMock = vi.fn();
const openWorkspaceMock = vi.fn();
const openTabMock = vi.fn();
const deleteMock = vi.fn();
const errorMock = vi.fn();

vi.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => errorMock(...args), success: vi.fn() } }));

vi.mock('@/lib/app-dev-api', () => ({
  listAppTemplates: (...args: unknown[]) => listMock(...args),
  deleteAppTemplate: (...args: unknown[]) => deleteMock(...args),
  openAppTemplateWorkspace: (...args: unknown[]) => openWorkspaceMock(...args),
}));

vi.mock('@/stores/app-plaza-shell', () => ({
  useAppPlazaShellStore: {
    getState: () => ({ openOrFocusDevAppTab: openTabMock }),
  },
}));

describe('AppTemplateManagerDialog', () => {
  const custom = {
    templateId: 'custom', pageType: 'site', name: '业务模板', description: '',
    status: 'ACTIVE', isBuiltin: false, latestVersion: '1.0.0', createdAt: '', updatedAt: '',
  };

  it('确认删除后移除卡片，取消不发送删除请求', async () => {
    listMock.mockResolvedValueOnce({ items: [custom] });
    deleteMock.mockResolvedValue({ templateId: 'custom', status: 'DISABLED' });
    render(<AppTemplateManagerDialog open onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '删除业务模板' }));
    expect(screen.getByRole('dialog', { name: '删除模板' })).toHaveTextContent('业务模板');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(deleteMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '删除业务模板' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(screen.queryByText('业务模板')).not.toBeInTheDocument());
    expect(deleteMock).toHaveBeenCalledWith('custom');
  });

  it('删除失败保留模板并展示错误', async () => {
    listMock.mockResolvedValueOnce({ items: [custom] });
    deleteMock.mockRejectedValueOnce(new Error('没有权限'));
    render(<AppTemplateManagerDialog open onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '删除业务模板' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(errorMock).toHaveBeenCalledWith('没有权限'));
    expect(screen.getByText('业务模板')).toBeInTheDocument();
  });

  it('内置模板没有删除入口', async () => {
    render(<AppTemplateManagerDialog open onClose={vi.fn()} />);
    await screen.findByText('标准 Site 模版');
    expect(screen.queryByRole('button', { name: /删除/ })).not.toBeInTheDocument();
  });

  it('删除请求等待期间禁止重复确认或取消', async () => {
    listMock.mockResolvedValueOnce({ items: [custom] });
    let finish!: () => void;
    deleteMock.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
    render(<AppTemplateManagerDialog open onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '删除业务模板' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    expect(screen.getByRole('button', { name: '删除中…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '删除中…' }));
    expect(deleteMock).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(screen.queryByRole('dialog', { name: '删除模板' })).not.toBeInTheDocument();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    listMock.mockResolvedValue({
      items: [{
        templateId: 'site-minimal',
        pageType: 'site',
        name: '标准 Site 模版',
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
    });
    openWorkspaceMock.mockResolvedValue({
      workspaceId: 'workspace-1',
      appPath: '/tmp/template',
      workspaceName: '模板：标准 Site 模版',
      templateId: 'site-minimal',
    });
  });

  it('列出模板并从独立入口打开模板工作区', async () => {
    const onClose = vi.fn();
    render(<AppTemplateManagerDialog open onClose={onClose} />);

    expect(await screen.findByText('标准 Site 模版')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));

    await waitFor(() => expect(openWorkspaceMock).toHaveBeenCalledWith(expect.objectContaining({
      templateId: 'site-minimal',
      pageType: 'site',
      latestVersion: '1.0.0',
    })));
    expect(openTabMock).toHaveBeenCalledWith('workspace-1', '模板：标准 Site 模版', 'template');
    expect(onClose).toHaveBeenCalled();
  });

  it('将本地内置模板作为调试工作区打开', async () => {
    listMock.mockResolvedValueOnce({
      items: [{
        templateId: 'assets-minimal',
        pageType: 'assets',
        name: '标准 Assets 模版',
        description: '本地资源模板',
        status: 'ACTIVE',
        isBuiltin: true,
        latestVersion: 'local',
        source: 'local-resource',
        createdAt: '',
        updatedAt: '',
      }],
      total: 1,
      pageNum: 1,
      pageSize: 100,
    });
    render(<AppTemplateManagerDialog open onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '调试' }));

    await waitFor(() => expect(openWorkspaceMock).toHaveBeenCalledWith(expect.objectContaining({
      templateId: 'assets-minimal',
      pageType: 'assets',
      latestVersion: 'local',
      source: 'local-resource',
    })));
  });
});
