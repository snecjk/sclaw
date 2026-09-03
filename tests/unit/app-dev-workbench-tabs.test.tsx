import { forwardRef, useImperativeHandle } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SclawBrowserFrameHandle } from '@/components/sclaw-browser/SclawBrowserFrame';
import { useAppDevWorkbenchStore } from '@/stores/app-dev-workbench';

vi.mock('@/components/sclaw-browser/SclawBrowserFrame', () => ({
  SclawBrowserFrame: forwardRef<SclawBrowserFrameHandle, {
    url: string;
    title: string;
  }>(function MockBrowserFrame({ url }, ref) {
    useImperativeHandle(ref, () => ({
      reload: vi.fn(),
      loadURL: vi.fn(),
      getURL: () => url,
      goBack: vi.fn(),
      canGoBack: vi.fn(() => false),
      executeJS: vi.fn(async () => null),
      getWebContentsId: vi.fn(() => null),
    }));
    return <div data-testid="preview-frame" data-url={url} />;
  }),
}));
vi.mock('@/components/app-dev/AppDevMonacoEditor', () => ({
  AppDevMonacoEditor: () => null,
  formatAppDevDiagnosticsPrompt: vi.fn(),
}));
vi.mock('@/components/app-dev/AppDevDiffViewer', () => ({
  AppDevDiffViewer: () => <div data-testid="diff-viewer" />,
}));
vi.mock('@/components/app-dev/AppDevGitPanel', () => ({
  AppDevGitPanel: () => <div data-testid="git-panel" />,
}));
vi.mock('@/components/app-dev/AppExternalServicesPanel', () => ({
  AppExternalServicesPanel: () => <div data-testid="external-services-panel" />,
}));
vi.mock('@/components/app-dev/AppDevCommunityPanel', () => ({
  AppDevCommunityPanel: () => <div data-testid="community-panel" />,
}));

const READY_STATUS = {
  workspaceId: 'ws-1',
  appPath: '/tmp/app',
  phase: 'ready',
  progress: 100,
  previewUrl: 'http://127.0.0.1:58967/',
} as const;

function renderStage() {
  return import('@/components/app-dev/AppDevWorkbenchStage').then(
    ({ AppDevWorkbenchStage }) => render(
      <AppDevWorkbenchStage
        workspaceId="ws-1"
        appName="测试应用"
        status={READY_STATUS}
        pendingErrors={[]}
        onFixErrors={vi.fn()}
        onDismissErrors={vi.fn()}
        onRetryStart={vi.fn()}
      />,
    ),
  );
}

describe('AppDevWorkbenchStage 页签收敛（预览 / 代码 / 版本 + 溢出菜单）', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppDevWorkbenchStore.setState({
      mode: 'preview',
      stageCollapsed: false,
      device: 'desktop',
      tuneMode: 'chat',
      diffRequest: null,
      versionRestoreRequest: null,
    });
  });

  it('shows 3 primary tabs plus an overflow menu trigger', async () => {
    await renderStage();

    expect(screen.getByRole('button', { name: '预览' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '代码' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '版本' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /更多/ })).toBeInTheDocument();
    // 溢出项不再平铺在页签栏
    expect(screen.queryByRole('button', { name: 'Git 代码管理' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '外部服务' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '社区' })).not.toBeInTheDocument();
  });

  it('switches the stage when the store mode changes (对话侧可驱动)', async () => {
    await renderStage();
    expect(screen.getByTestId('preview-frame')).toBeInTheDocument();

    // 版本页签：T04 已挂载 diff 容器（本测试 mock 掉 Monaco）
    useAppDevWorkbenchStore.getState().setMode('versions');
    await waitFor(() => {
      expect(screen.getByTestId('diff-viewer')).toBeInTheDocument();
    });

    // 溢出菜单面板同样由 store mode 驱动
    useAppDevWorkbenchStore.getState().setMode('more-git');
    await waitFor(() => {
      expect(screen.getByTestId('git-panel')).toBeInTheDocument();
    });

    useAppDevWorkbenchStore.getState().setMode('more-external');
    await waitFor(() => {
      expect(screen.getByTestId('external-services-panel')).toBeInTheDocument();
    });

    useAppDevWorkbenchStore.getState().setMode('more-community');
    await waitFor(() => {
      expect(screen.getByTestId('community-panel')).toBeInTheDocument();
    });
  });

  it('opens overflow panels from the 更多 menu', async () => {
    await renderStage();

    // radix DropdownMenu 在 pointerdown 时即打开
    fireEvent.pointerDown(screen.getByRole('button', { name: /更多/ }));

    const gitItem = await screen.findByRole('menuitem', { name: /Git 代码管理/ });
    expect(screen.getByRole('menuitem', { name: /外部服务/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /社区/ })).toBeInTheDocument();

    fireEvent.click(gitItem);
    await waitFor(() => {
      expect(screen.getByTestId('git-panel')).toBeInTheDocument();
    });
  });
});

describe('AppDevSplitBody 收起工作区', () => {
  it('renders chat full-width and keeps the stage mounted but hidden', async () => {
    const { AppDevSplitBody } = await import('@/components/app-dev/AppDevSplitBody');
    render(
      <AppDevSplitBody
        stageCollapsed
        chat={<div data-testid="chat-pane">chat</div>}
      >
        <div data-testid="stage-pane">stage</div>
      </AppDevSplitBody>,
    );

    expect(screen.getByTestId('chat-pane')).toBeInTheDocument();
    // 工作台保活隐藏（避免 webview 重载），而不是卸载
    const stage = screen.getByTestId('stage-pane');
    expect(stage.parentElement).toHaveClass('w-0');
    expect(stage.parentElement).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders the resizable split when not collapsed', async () => {
    const { AppDevSplitBody } = await import('@/components/app-dev/AppDevSplitBody');
    render(
      <AppDevSplitBody chat={<div data-testid="chat-pane">chat</div>}>
        <div data-testid="stage-pane">stage</div>
      </AppDevSplitBody>,
    );

    expect(screen.getByTestId('chat-pane')).toBeInTheDocument();
    expect(screen.getByTestId('stage-pane')).toBeInTheDocument();
    expect(screen.getByTestId('stage-pane').parentElement).not.toHaveClass('w-0');
  });
});
