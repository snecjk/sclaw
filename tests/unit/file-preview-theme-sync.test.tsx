import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FilePreviewViewer, RemoteSrcDocPreview } from '@/components/file-preview/FilePreviewViewer';

const themeState = vi.hoisted(() => ({
  appearance: 'light' as 'light' | 'dark',
  postResolvedAppearance: vi.fn(),
}));

vi.mock('@/components/theme/appearance-context', () => ({
  STO_APPEARANCE_MESSAGE_TYPE: 'sto:appearance-change',
  useThemeAppearance: () => themeState.appearance,
  postResolvedAppearance: themeState.postResolvedAppearance,
}));

describe('remote srcDoc appearance synchronization', () => {
  beforeEach(() => {
    themeState.appearance = 'light';
    themeState.postResolvedAppearance.mockReset();
  });

  it('preserves the adaptive iframe and sends one runtime update when appearance changes', async () => {
    const props = {
      html: '<html><head></head><body>draft</body></html>',
      sourceUrl: 'https://cdn.example.com/reports/draft.html',
      fileName: 'draft.html',
    };
    const { rerender } = render(<RemoteSrcDocPreview {...props} />);
    const initialFrame = screen.getByTitle(props.fileName);
    const initialSrcDoc = initialFrame.getAttribute('srcdoc');
    expect(initialSrcDoc).toContain('data-sto-theme="light"');
    expect(initialSrcDoc).toContain('data-sto-preview-mode="adaptive"');
    expect(initialFrame).toHaveAttribute('data-sto-theme-sync', 'true');
    await waitFor(() => expect(themeState.postResolvedAppearance).toHaveBeenCalledTimes(1));
    themeState.postResolvedAppearance.mockClear();

    themeState.appearance = 'dark';
    rerender(<RemoteSrcDocPreview {...props} />);

    const updatedFrame = screen.getByTitle(props.fileName);
    expect(updatedFrame).toBe(initialFrame);
    expect(updatedFrame.getAttribute('srcdoc')).toBe(initialSrcDoc);
    await waitFor(() => {
      expect(themeState.postResolvedAppearance).toHaveBeenCalledTimes(1);
      expect(themeState.postResolvedAppearance).toHaveBeenCalledWith(
        updatedFrame.contentWindow,
        'dark',
      );
    });
  });

  it('keeps directly served authored HTML in fidelity mode', () => {
    themeState.appearance = 'dark';

    render(
      <FilePreviewViewer
        filePath="/tmp/authored-report.html"
        fileName="authored-report.html"
        mimeType="text/html"
      />,
    );

    const frame = screen.getByTitle('authored-report.html');
    expect(frame).toHaveAttribute('src');
    expect(frame).not.toHaveAttribute('srcdoc');
    expect(frame).not.toHaveAttribute('data-sto-theme-sync');
    expect(frame).toHaveStyle({ colorScheme: 'dark' });
    expect(themeState.postResolvedAppearance).not.toHaveBeenCalled();
  });

  it.each([
    {
      identity: 'HTML',
      nextHtml: '<html><head></head><body>final</body></html>',
      nextSourceUrl: 'https://cdn.example.com/reports/draft.html',
      expectedContent: '<body>final</body>',
      expectedBase: '<base href="https://cdn.example.com/reports/">',
    },
    {
      identity: 'source URL',
      nextHtml: '<html><head></head><body>draft</body></html>',
      nextSourceUrl: 'https://assets.example.com/final/final.html',
      expectedContent: '<body>draft</body>',
      expectedBase: '<base href="https://assets.example.com/final/">',
    },
  ])('creates a new iframe and dark initial srcDoc when $identity changes', ({
    nextHtml,
    nextSourceUrl,
    expectedContent,
    expectedBase,
  }) => {
    const initialProps = {
      html: '<html><head></head><body>draft</body></html>',
      sourceUrl: 'https://cdn.example.com/reports/draft.html',
      fileName: 'draft.html',
    };
    const { rerender } = render(<RemoteSrcDocPreview {...initialProps} />);
    const initialFrame = screen.getByTitle(initialProps.fileName);

    themeState.appearance = 'dark';
    const nextProps = {
      html: nextHtml,
      sourceUrl: nextSourceUrl,
      fileName: 'final.html',
    };
    rerender(<RemoteSrcDocPreview {...nextProps} />);

    const updatedFrame = screen.getByTitle(nextProps.fileName);
    expect(updatedFrame).not.toBe(initialFrame);
    expect(updatedFrame.getAttribute('srcdoc')).toContain('data-sto-theme="dark"');
    expect(updatedFrame.getAttribute('srcdoc')).toContain(expectedContent);
    expect(updatedFrame.getAttribute('srcdoc')).toContain(expectedBase);
  });
});
