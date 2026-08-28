import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const statusMock = vi.fn();
const pickFolderMock = vi.fn();
const prepareMock = vi.fn();
const applyMock = vi.fn();
const cancelMock = vi.fn();

vi.mock('@/lib/app-dev-api', () => ({
  getAppTemplateImportStatus: (...args: unknown[]) => statusMock(...args),
  prepareAppTemplateImport: (...args: unknown[]) => prepareMock(...args),
  applyAppTemplateImport: (...args: unknown[]) => applyMock(...args),
  cancelAppTemplateImport: (...args: unknown[]) => cancelMock(...args),
}));
vi.mock('@/lib/session-catalog-api', () => ({
  pickProjectFolder: (...args: unknown[]) => pickFolderMock(...args),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TemplateProjectUploadControl } from '@/components/more-apps/TemplateProjectUploadControl';
import { createTemplateImportPreview } from './helpers/app-template-import-fixtures';

describe('TemplateProjectUploadControl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cancelMock.mockResolvedValue({ cancelled: true });
  });

  it('selects a folder on first upload, then becomes re-upload after apply', async () => {
    statusMock
      .mockResolvedValueOnce({ hasSource: false, sourceAvailable: false })
      .mockResolvedValueOnce({ hasSource: true, sourceName: 'demo', sourceAvailable: true });
    pickFolderMock.mockResolvedValueOnce('/source/demo');
    prepareMock.mockResolvedValueOnce(createTemplateImportPreview());
    applyMock.mockResolvedValueOnce({
      changedFiles: ['src/App.tsx'],
      checkpointCreated: true,
      importedAt: '2026-08-28T00:00:00Z',
      restartRequested: true,
    });
    const onApplied = vi.fn();
    render(<TemplateProjectUploadControl workspaceId="ws-1" onApplied={onApplied} />);

    fireEvent.click(await screen.findByRole('button', { name: '上传项目' }));
    await waitFor(() => expect(prepareMock).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      sourcePath: '/source/demo',
    }));
    fireEvent.click(await screen.findByRole('button', { name: '确认覆盖' }));

    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: '重新上传' })).toBeInTheDocument();
  });

  it('reuses an available source without opening the folder picker', async () => {
    statusMock.mockResolvedValueOnce({ hasSource: true, sourceName: 'demo', sourceAvailable: true });
    prepareMock.mockResolvedValueOnce(createTemplateImportPreview());
    render(<TemplateProjectUploadControl workspaceId="ws-1" onApplied={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '重新上传' }));

    await waitFor(() => expect(prepareMock).toHaveBeenCalledWith({ workspaceId: 'ws-1' }));
    expect(pickFolderMock).not.toHaveBeenCalled();
  });
});
