import { forwardRef, useImperativeHandle } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SclawBrowserFrameHandle } from '@/components/sclaw-browser/SclawBrowserFrame';

const mocks = vi.hoisted(() => ({
  loadUrl: vi.fn(),
  openExternalUrl: vi.fn(),
  currentUrl: '',
}));

vi.mock('@/components/sclaw-browser/SclawBrowserFrame', () => ({
  SclawBrowserFrame: forwardRef<SclawBrowserFrameHandle, {
    url: string;
    title: string;
  }>(function MockBrowserFrame({ url }, ref) {
    mocks.currentUrl = url;
    useImperativeHandle(ref, () => ({
      reload: vi.fn(),
      loadURL: (next: string) => {
        mocks.currentUrl = next;
        mocks.loadUrl(next);
      },
      getURL: () => mocks.currentUrl,
      goBack: vi.fn(),
      canGoBack: vi.fn(() => false),
      executeJS: vi.fn(async () => null),
      getWebContentsId: vi.fn(() => null),
    }));
    return <div data-testid="preview-frame" data-url={url} />;
  }),
}));
vi.mock('@/lib/preview-url', () => ({
  openExternalUrl: (...args: unknown[]) => mocks.openExternalUrl(...args),
}));
vi.mock('@/components/app-dev/AppDevMonacoEditor', () => ({
  AppDevMonacoEditor: () => null,
  formatAppDevDiagnosticsPrompt: vi.fn(),
}));

describe('AppDevWorkbenchStage preview authentication boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUrl = '';
  });

  it('never mounts, navigates, or opens a preview URL containing legacy auth data', async () => {
    const { AppDevWorkbenchStage } = await import(
      '@/components/app-dev/AppDevWorkbenchStage'
    );
    render(
      <AppDevWorkbenchStage
        workspaceId="ws-1"
        appName="测试应用"
        status={{
          workspaceId: 'ws-1',
          appPath: '/tmp/app',
          phase: 'ready',
          progress: 100,
          previewUrl: 'http://127.0.0.1:58967/?stoToken=tok-1&code=abc&x=1#/home',
        }}
        pendingErrors={[]}
        onFixErrors={vi.fn()}
        onDismissErrors={vi.fn()}
        onRetryStart={vi.fn()}
      />,
    );

    const clean = 'http://127.0.0.1:58967/?x=1#/home';
    await waitFor(() => expect(screen.getByTestId('preview-frame')).toHaveAttribute(
      'data-url',
      clean,
    ));
    expect(screen.getByLabelText('预览地址')).toHaveValue(clean);

    fireEvent.click(screen.getByRole('button', { name: /在系统浏览器打开/ }));
    expect(mocks.openExternalUrl).toHaveBeenCalledWith(clean);

    const address = screen.getByLabelText('预览地址');
    fireEvent.change(address, {
      target: { value: 'http://127.0.0.1:58967/?authorizationCode=def&y=2#/next' },
    });
    fireEvent.submit(address.closest('form')!);
    expect(mocks.loadUrl).toHaveBeenCalledWith(
      'http://127.0.0.1:58967/?y=2#/next',
    );
  });
});
