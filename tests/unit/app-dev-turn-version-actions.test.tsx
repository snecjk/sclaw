/**
 * T04 汇总卡操作行 [恢复版本｜查看修改] 组件测试。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDevTurnVersionActions } from '@/components/app-dev/AppDevTurnVersionActions';
import { useAppDevVersionsStore } from '@/stores/app-dev-versions';
import { useAppDevWorkbenchStore } from '@/stores/app-dev-workbench';

const mocks = vi.hoisted(() => ({
  listAppCheckpoints: vi.fn(),
}));

vi.mock('@/lib/app-dev-api', () => ({
  listAppCheckpoints: (...args: unknown[]) => mocks.listAppCheckpoints(...args),
}));

const WORKBENCH_DEFAULTS = {
  mode: 'preview',
  stageCollapsed: false,
  device: 'desktop',
  tuneMode: 'chat',
  diffRequest: null,
  versionRestoreRequest: null,
} as const;

function seedMapped(workspaceId = 'ws-1', turnKey = 'turn-user-u1') {
  useAppDevVersionsStore.setState({
    versionsByWorkspace: {
      [workspaceId]: {
        [turnKey]: {
          hash: 'hash-u1',
          subject: '对话修改 · 把标题改蓝',
          timestamp: 2_000,
          turnEndedAt: 1_000,
          userTextExcerpt: '把标题改蓝',
        },
      },
    },
    pendingTurnsByWorkspace: {},
  });
}

describe('AppDevTurnVersionActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAppDevVersionsStore.setState({ versionsByWorkspace: {}, pendingTurnsByWorkspace: {} });
    useAppDevWorkbenchStore.setState({ ...WORKBENCH_DEFAULTS });
  });

  it('有 turnKey 映射：渲染两按钮，不拉 checkpoint 列表', () => {
    seedMapped();
    render(
      <AppDevTurnVersionActions workspaceId="ws-1" turnKey="turn-user-u1" turnEndedAt={1_000} />,
    );

    expect(screen.getByRole('button', { name: /恢复版本/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /查看修改/ })).toBeInTheDocument();
    expect(mocks.listAppCheckpoints).not.toHaveBeenCalled();
  });

  it('「查看修改」→ diffRequest + 切版本页签 + 展开收起的工作区', () => {
    seedMapped();
    useAppDevWorkbenchStore.setState({ stageCollapsed: true });
    render(
      <AppDevTurnVersionActions workspaceId="ws-1" turnKey="turn-user-u1" turnEndedAt={1_000} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /查看修改/ }));

    const workbench = useAppDevWorkbenchStore.getState();
    expect(workbench.diffRequest).toEqual({ hash: 'hash-u1' });
    expect(workbench.mode).toBe('versions');
    expect(workbench.stageCollapsed).toBe(false);
  });

  it('「恢复版本」→ versionRestoreRequest（确认框由 pane 消费）', () => {
    seedMapped();
    render(
      <AppDevTurnVersionActions workspaceId="ws-1" turnKey="turn-user-u1" turnEndedAt={1_000} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /恢复版本/ }));

    expect(useAppDevWorkbenchStore.getState().versionRestoreRequest).toEqual({ hash: 'hash-u1' });
    // 查看修改请求不被误触发
    expect(useAppDevWorkbenchStore.getState().diffRequest).toBeNull();
  });

  it('映射缺失：降级 listAppCheckpoints 按时间戳最近邻对齐', async () => {
    mocks.listAppCheckpoints.mockResolvedValue([
      { hash: 'h-old', subject: 's1', timestamp: 10_000 },
      { hash: 'h-near', subject: 's2', timestamp: 20_000 },
    ]);
    render(
      <AppDevTurnVersionActions workspaceId="ws-1" turnKey="turn-user-old" turnEndedAt={20_500} />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /查看修改/ })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /查看修改/ }));
    expect(useAppDevWorkbenchStore.getState().diffRequest).toEqual({ hash: 'h-near' });
  });

  it('映射缺失且最近邻超窗 / 无结束时间：不渲染按钮', async () => {
    mocks.listAppCheckpoints.mockResolvedValue([
      { hash: 'h1', subject: 's1', timestamp: 10_000 },
    ]);
    const { container: far } = render(
      <AppDevTurnVersionActions workspaceId="ws-1" turnKey="t1" turnEndedAt={10_000 + 30 * 60_000} />,
    );
    await waitFor(() => {
      expect(mocks.listAppCheckpoints).toHaveBeenCalled();
    });
    expect(far).toBeEmptyDOMElement();

    const { container: noTime } = render(
      <AppDevTurnVersionActions workspaceId="ws-1" turnKey="t2" turnEndedAt={null} />,
    );
    expect(noTime).toBeEmptyDOMElement();
  });
});
