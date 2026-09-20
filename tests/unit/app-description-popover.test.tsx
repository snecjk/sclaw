import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDescriptionPopover } from '@/components/app-dev/AppDescriptionPopover';

const getAppDescriptionMock = vi.fn();
const updateAppDescriptionMock = vi.fn();

vi.mock('@/lib/app-dev-api', () => ({
  getAppDescription: (...args: unknown[]) => getAppDescriptionMock(...args),
  updateAppDescription: (...args: unknown[]) => updateAppDescriptionMock(...args),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn() },
}));

describe('AppDescriptionPopover', () => {
  beforeEach(() => {
    getAppDescriptionMock.mockReset();
    updateAppDescriptionMock.mockReset();
    getAppDescriptionMock.mockResolvedValue({
      description: '原应用描述',
      bound: true,
      source: 'remote',
    });
    updateAppDescriptionMock.mockResolvedValue({ description: '新应用描述', bound: true });
  });

  it('loads the description and disables save until the draft changes', async () => {
    render(<AppDescriptionPopover workspaceId="ws-1" appName="测试应用" />);

    const titleButton = screen.getByRole('button', { name: '测试应用' });
    expect(titleButton.querySelector('.lucide-chevron-down')).not.toBeInTheDocument();
    fireEvent.click(titleButton);
    expect(await screen.findByDisplayValue('原应用描述')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('应用描述'), { target: { value: '新应用描述' } });
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
  });

  it('saves a normalized draft and closes after success', async () => {
    render(<AppDescriptionPopover workspaceId="ws-1" appName="测试应用" />);
    fireEvent.click(screen.getByRole('button', { name: '测试应用' }));
    await screen.findByDisplayValue('原应用描述');

    fireEvent.change(screen.getByLabelText('应用描述'), { target: { value: '  新应用描述  ' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(updateAppDescriptionMock).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      description: '新应用描述',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps the draft open when saving fails', async () => {
    updateAppDescriptionMock.mockRejectedValueOnce(new Error('远程更新失败'));
    render(<AppDescriptionPopover workspaceId="ws-1" appName="测试应用" />);
    fireEvent.click(screen.getByRole('button', { name: '测试应用' }));
    await screen.findByDisplayValue('原应用描述');

    fireEvent.change(screen.getByLabelText('应用描述'), { target: { value: '未同步草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('远程更新失败')).toBeInTheDocument();
    expect(screen.getByDisplayValue('未同步草稿')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('resets and loads the new workspace after switching', async () => {
    const { rerender } = render(<AppDescriptionPopover key="ws-1" workspaceId="ws-1" appName="应用一" />);
    fireEvent.click(screen.getByRole('button', { name: '应用一' }));
    await screen.findByDisplayValue('原应用描述');

    getAppDescriptionMock.mockResolvedValueOnce({ description: '应用二描述', bound: false, source: 'local' });
    rerender(<AppDescriptionPopover key="ws-2" workspaceId="ws-2" appName="应用二" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '应用二' }));
    expect(await screen.findByDisplayValue('应用二描述')).toBeInTheDocument();
  });
});
