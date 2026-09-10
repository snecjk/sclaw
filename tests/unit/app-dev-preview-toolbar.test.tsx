import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SclawBrowserFrameHandle } from '@/components/sclaw-browser/SclawBrowserFrame';
import { useAppDevWorkbenchStore } from '@/stores/app-dev-workbench';

const mocks = vi.hoisted(() => ({
  loadUrl: vi.fn(),
  openExternalUrl: vi.fn(),
  listAppRoutes: vi.fn(),
  currentUrl: '',
  /** webview 加载探针：remount 会让 mounts 增加 / unmounts 非零。 */
  mounts: 0,
  unmounts: 0,
}));

vi.mock('@/components/sclaw-browser/SclawBrowserFrame', () => ({
  SclawBrowserFrame: forwardRef<SclawBrowserFrameHandle, {
    url: string;
    title: string;
  }>(function MockBrowserFrame({ url }, ref) {
    useEffect(() => {
      mocks.mounts += 1;
      return () => {
        mocks.unmounts += 1;
      };
    }, []);
    useImperativeHandle(ref, () => ({
      reload: vi.fn(),
      loadURL: (next: string) => {
        mocks.currentUrl = next;
        mocks.loadUrl(next);
      },
      getURL: () => mocks.currentUrl || url,
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
vi.mock('@/lib/app-dev-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/app-dev-api')>()),
  listAppRoutes: (...args: unknown[]) => mocks.listAppRoutes(...args),
}));
vi.mock('@/components/app-dev/AppDevMonacoEditor', () => ({
  AppDevMonacoEditor: () => null,
  formatAppDevDiagnosticsPrompt: vi.fn(),
}));
vi.mock('@/components/app-dev/AppDevDiffViewer', () => ({
  AppDevDiffViewer: () => null,
}));
vi.mock('@/components/app-dev/AppDevGitPanel', () => ({
  AppDevGitPanel: () => null,
}));
vi.mock('@/components/app-dev/AppExternalServicesPanel', () => ({
  AppExternalServicesPanel: () => null,
}));
vi.mock('@/components/app-dev/AppDevCommunityPanel', () => ({
  AppDevCommunityPanel: () => null,
}));

const READY_STATUS = {
  workspaceId: 'ws-1',
  appPath: '/tmp/app',
  phase: 'ready',
  progress: 100,
  previewUrl: 'http://127.0.0.1:58967/',
} as const;

const DISCOVERED_ROUTES = [
  { path: '#/home', label: '/home', source: 'router' as const },
  { path: '#/example', label: '/example', source: 'router' as const },
];

async function renderStage() {
  const { AppDevWorkbenchStage } = await import('@/components/app-dev/AppDevWorkbenchStage');
  return render(
    <AppDevWorkbenchStage
      workspaceId="ws-1"
      appName="测试应用"
      status={READY_STATUS}
      pendingErrors={[]}
      onFixErrors={vi.fn()}
      onDismissErrors={vi.fn()}
      onRetryStart={vi.fn()}
    />,
  );
}

describe('AppDevPreviewToolbar 预览工具条升级（T03）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUrl = '';
    mocks.mounts = 0;
    mocks.unmounts = 0;
    mocks.listAppRoutes.mockResolvedValue(DISCOVERED_ROUTES);
    localStorage.clear();
    useAppDevWorkbenchStore.setState({
      mode: 'preview',
      stageCollapsed: false,
      device: 'desktop',
      tuneMode: 'chat',
      inspectActive: false,
      diffRequest: null,
      versionRestoreRequest: null,
    });
  });

  it('设备切换到手机视图：390px 设备框且 webview 不 remount', async () => {
    await renderStage();
    const frameBefore = screen.getByTestId('preview-frame');
    const viewport = frameBefore.closest('.app-dev-preview-viewport');
    expect(viewport).toHaveAttribute('data-device', 'desktop');
    expect(mocks.mounts).toBe(1);

    // Radix Tabs Trigger 在 mouseDown（automatic activation）时切换
    fireEvent.mouseDown(screen.getByRole('tab', { name: '手机视图' }));

    await waitFor(() => {
      expect(viewport).toHaveAttribute('data-device', 'mobile');
    });
    expect(useAppDevWorkbenchStore.getState().device).toBe('mobile');
    // 关键断言：预览帧是同一个 DOM 节点，加载探针没有新增（未 remount）
    expect(screen.getByTestId('preview-frame')).toBe(frameBefore);
    expect(mocks.mounts).toBe(1);
    expect(mocks.unmounts).toBe(0);
    expect(mocks.loadUrl).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByRole('tab', { name: '桌面视图' }));
    await waitFor(() => {
      expect(viewport).toHaveAttribute('data-device', 'desktop');
    });
    expect(screen.getByTestId('preview-frame')).toBe(frameBefore);
    expect(mocks.mounts).toBe(1);
    expect(mocks.unmounts).toBe(0);
  });

  it('opens system browser from an icon inside the device cluster', async () => {
    await renderStage();
    const openExternal = screen.getByRole('button', { name: '在系统浏览器打开' });
    expect(openExternal).toHaveAttribute('title', '在系统浏览器打开');
    expect(openExternal).not.toHaveTextContent('在系统浏览器打开');
    expect(openExternal.closest('[aria-label="预览视口"]')).not.toBeNull();
    fireEvent.click(openExternal);
    expect(mocks.openExternalUrl).toHaveBeenCalled();
  });

  it('路由下拉列出应用页面，选择后跳转且地址栏同步', async () => {
    await renderStage();
    await waitFor(() => {
      expect(mocks.listAppRoutes).toHaveBeenCalledWith('ws-1');
    });

    fireEvent.pointerDown(screen.getByRole('button', { name: '切换预览页面' }));
    const item = await screen.findByRole('menuitem', { name: '/example' });
    expect(screen.getByRole('menuitem', { name: '/home' })).toBeInTheDocument();

    fireEvent.click(item);
    expect(mocks.loadUrl).toHaveBeenCalledWith('http://127.0.0.1:58967/#/example');

    const address = screen.getByLabelText('预览地址');
    await waitFor(() => {
      expect(address).toHaveValue('http://127.0.0.1:58967/#/example');
    });
    // 当前页命中路由：触发器展示该页 label
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '切换预览页面' })).toHaveTextContent('/example');
    });
  });

  it('路由发现失败时降级为当前地址单条，点击不跳转', async () => {
    mocks.listAppRoutes.mockRejectedValue(new Error('host api unavailable'));
    await renderStage();

    fireEvent.pointerDown(screen.getByRole('button', { name: '切换预览页面' }));
    const fallback = await screen.findByRole('menuitem', {
      name: 'http://127.0.0.1:58967/',
    });
    fireEvent.click(fallback);
    expect(mocks.loadUrl).not.toHaveBeenCalled();
  });

  it('全屏：进入后容器挂覆盖类，按钮与 Esc 均可退出', async () => {
    const { container } = await renderStage();
    // jsdom 无 requestFullscreen → 走 CSS fixed 降级路径
    fireEvent.click(screen.getByRole('button', { name: '全屏预览' }));

    await waitFor(() => {
      expect(container.querySelector('.app-dev-preview-fullscreen')).not.toBeNull();
    });
    const exitButton = screen.getByRole('button', { name: '退出全屏' });
    expect(exitButton).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(exitButton);
    await waitFor(() => {
      expect(container.querySelector('.app-dev-preview-fullscreen')).toBeNull();
    });

    // 再次进入，用 Esc 退出
    fireEvent.click(screen.getByRole('button', { name: '全屏预览' }));
    await waitFor(() => {
      expect(container.querySelector('.app-dev-preview-fullscreen')).not.toBeNull();
    });
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(container.querySelector('.app-dev-preview-fullscreen')).toBeNull();
    });
    // 全屏进出同样不 remount 预览帧
    expect(mocks.mounts).toBe(1);
    expect(mocks.unmounts).toBe(0);
  });

  it('对话修改 and 手动微调 are independent toolbar actions', async () => {
    const onOpenTune = vi.fn();
    const onToggleInspect = vi.fn();
    const { AppDevWorkbenchStage } = await import('@/components/app-dev/AppDevWorkbenchStage');
    render(
      <AppDevWorkbenchStage
        workspaceId="ws-1"
        appName="测试应用"
        status={READY_STATUS}
        pendingErrors={[]}
        onFixErrors={vi.fn()}
        onDismissErrors={vi.fn()}
        onRetryStart={vi.fn()}
        onOpenTune={onOpenTune}
        onToggleInspect={onToggleInspect}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '对话修改' }));
    expect(onToggleInspect).toHaveBeenCalledTimes(1);
    expect(onOpenTune).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '手动微调' }));
    expect(onOpenTune).toHaveBeenCalledTimes(1);
    expect(onToggleInspect).toHaveBeenCalledTimes(1);
  });
});
