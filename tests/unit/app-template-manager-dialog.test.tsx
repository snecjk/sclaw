import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppTemplateManagerDialog } from '@/components/more-apps/AppTemplateManagerDialog';

const listMock = vi.fn();
const openWorkspaceMock = vi.fn();
const openTabMock = vi.fn();

vi.mock('@/lib/app-dev-api', () => ({
  listAppTemplates: (...args: unknown[]) => listMock(...args),
  openAppTemplateWorkspace: (...args: unknown[]) => openWorkspaceMock(...args),
}));

vi.mock('@/stores/app-plaza-shell', () => ({
  useAppPlazaShellStore: {
    getState: () => ({ openOrFocusDevAppTab: openTabMock }),
  },
}));

describe('AppTemplateManagerDialog', () => {
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
