import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ refresh: vi.fn(), resources: vi.fn() }));
vi.mock('@/lib/app-dev-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/app-dev-api')>(),
  refreshStoAppDeploy: api.refresh,
  getStoAppDeployResources: api.resources,
}));

import { StoAppDeployHistoryDialog } from '@/components/app-dev/StoAppDeployHistoryDialog';

describe('StoAppDeployHistoryDialog', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.refresh.mockResolvedValue({
      success: true,
      deploymentId: 'dep_1',
      data: { deployment_id: 'dep_1', status: 'SUCCESS', pipeline_instance_id: '5587' },
    });
    api.resources.mockResolvedValue({
      success: true,
      data: [{ id: 1, available: true, pages: ['https://a.test/index.html'] }],
    });
  });

  it('selects the latest record, refreshes it, and loads successful artifacts', async () => {
    render(<StoAppDeployHistoryDialog
      open
      workspaceId="ws-1"
      appCode="app_1"
      history={[{ deploymentId: 'dep_1', status: 'SUCCESS', startedAt: 2, updatedAt: 2 }]}
      onOpenChange={vi.fn()}
    />);
    expect(screen.getByRole('dialog', { name: '发布记录' })).toBeInTheDocument();
    await waitFor(() => expect(api.refresh).toHaveBeenCalledWith({
      workspaceId: 'ws-1', appCode: 'app_1', deploymentId: 'dep_1',
    }));
    await waitFor(() => expect(api.resources).toHaveBeenCalledWith({
      workspaceId: 'ws-1', appCode: 'app_1', pipelineInstanceId: '5587',
    }));
    expect(await screen.findByText('index.html')).toBeInTheDocument();
  });

  it('renders above the full-screen app workbench layer', () => {
    render(<StoAppDeployHistoryDialog
      open
      workspaceId="ws-1"
      history={[]}
      onOpenChange={vi.fn()}
    />);

    const dialog = screen.getByRole('dialog', { name: '发布记录' });
    const overlay = document.querySelector('[data-state="open"].fixed.inset-0');
    expect(dialog).toHaveClass('!z-[260]');
    expect(overlay).toHaveClass('!z-[260]');
  });

  it('does not query artifacts for failed deployments', async () => {
    api.refresh.mockResolvedValue({
      success: true,
      deploymentId: 'dep_failed',
      data: { deployment_id: 'dep_failed', status: 'FAILED', failure_message: '构建失败' },
    });
    render(<StoAppDeployHistoryDialog
      open
      workspaceId="ws-1"
      history={[{ deploymentId: 'dep_failed', status: 'FAILED', startedAt: 1, updatedAt: 1 }]}
      onOpenChange={vi.fn()}
    />);
    await waitFor(() => expect(api.refresh).toHaveBeenCalled());
    expect(api.resources).not.toHaveBeenCalled();
    expect(await screen.findByText('构建失败')).toBeInTheDocument();
  });
});
