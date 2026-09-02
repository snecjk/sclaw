import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BuiltinTemplateDebugControl } from '@/components/more-apps/BuiltinTemplateDebugControl';

const statusMock = vi.fn();
const syncMock = vi.fn();
const resetMock = vi.fn();

vi.mock('@/lib/app-dev-api', () => ({
  getBuiltinTemplateDebugStatus: (...args: unknown[]) => statusMock(...args),
  syncBuiltinTemplateDebugWorkspace: (...args: unknown[]) => syncMock(...args),
  resetBuiltinTemplateDebugWorkspace: (...args: unknown[]) => resetMock(...args),
}));

describe('BuiltinTemplateDebugControl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    statusMock.mockResolvedValue({
      isBuiltinDebug: true,
      templateId: 'site-minimal',
      pageType: 'site',
      sourceChanged: false,
      changes: [{ path: 'src/App.tsx', kind: 'modify' }],
    });
    syncMock.mockResolvedValue({ changedFiles: ['src/App.tsx'] });
    resetMock.mockResolvedValue({ changedFiles: ['src/App.tsx'] });
  });

  it('shows local differences and syncs them back only after confirmation', async () => {
    render(<BuiltinTemplateDebugControl workspaceId="ws-1" onReloaded={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '内置差异 1' }));
    expect(screen.getByText('src/App.tsx')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '同步回内置模板' }));
    fireEvent.click(screen.getByRole('button', { name: '确认同步' }));

    await waitFor(() => expect(syncMock).toHaveBeenCalledWith('ws-1'));
  });

  it('warns instead of offering sync when resources changed outside the workspace', async () => {
    statusMock.mockResolvedValueOnce({
      isBuiltinDebug: true,
      templateId: 'assets-minimal',
      pageType: 'assets',
      sourceChanged: true,
      changes: [{ path: 'package.json', kind: 'modify' }],
    });
    render(<BuiltinTemplateDebugControl workspaceId="ws-2" onReloaded={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '内置差异 1' }));

    expect(screen.getByText('内置源码已发生变化，请先重新加载。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '同步回内置模板' })).not.toBeInTheDocument();
  });

  it('keeps the parent in a fail-closed state when status cannot be read', async () => {
    const onStatusChange = vi.fn();
    statusMock.mockRejectedValueOnce(new Error('status unavailable'));

    render(
      <BuiltinTemplateDebugControl
        workspaceId="ws-3"
        onReloaded={vi.fn()}
        onStatusChange={onStatusChange}
      />,
    );

    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith(null));
    expect(screen.queryByRole('button', { name: /\u5185置差异/ })).not.toBeInTheDocument();
  });
});
