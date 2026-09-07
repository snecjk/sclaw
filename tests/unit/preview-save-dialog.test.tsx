import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ChatPreviewPanel } from '@/pages/Chat/ChatPreviewPanel';
import { SaveArtifactDialog } from '@/components/file-preview/SaveArtifactDialog';

vi.mock('@/lib/data-center-api', () => ({
  listDataCenterEntries: async () => ({ items: [] }),
}));

vi.mock('@/components/file-preview/FilePreviewViewer', () => ({
  FilePreviewViewer: () => <p>File preview</p>,
}));

function Harness() {
  const [open, setOpen] = useState(true);
  return <>{open ? <SaveArtifactDialog
    file={{ filePath: '/tmp/qa.html', fileName: 'qa.html', mimeType: 'text/html', fileSize: 10 }}
    onClose={() => setOpen(false)} onSaved={() => setOpen(false)} escapeDismiss
  /> : <p>Preview remains open</p>}</>;
}

describe('save dialog over narrow preview', () => {
  beforeEach(async () => { await i18n.changeLanguage('en'); });
  it('keeps the save dialog outside the floating panel stacking context', async () => {
    const view = render(<TooltipProvider><ChatPreviewPanel
      tabs={[{ kind: 'file', id: 'qa', file: { filePath: '/tmp/qa.html', fileName: 'qa.html', mimeType: 'text/html', fileSize: 10 } }]}
      activeTabId="qa" sessionKey="qa" isPreviewOverlay
    /></TooltipProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Save to Data Center' }));
    const dialog = screen.getByRole('dialog', { name: 'Save to Data Center' });
    expect(document.body).toContainElement(dialog);
    expect(view.container).not.toContainElement(dialog);
    await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('File preview')).toBeInTheDocument();
  });

  it('dismisses the folder dialog before the save dialog with Escape', async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '+ New folder' }));
    const input = screen.getByPlaceholderText('Folder name');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByPlaceholderText('Folder name')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Save to Data Center' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByText('Preview remains open')).toBeInTheDocument();
  });
});
