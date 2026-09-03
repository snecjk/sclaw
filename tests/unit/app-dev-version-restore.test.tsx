/**
 * T04 消息级「恢复版本」流程测试（mock restoreAppCheckpoint + toast）：
 * store 请求 → 确认目标（含 subject 标签） → confirm 回滚 → 刷新回调 / 失败提示。
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppDevVersionRestore } from '@/hooks/use-app-dev-version-restore';
import { useAppDevVersionsStore } from '@/stores/app-dev-versions';
import { useAppDevWorkbenchStore } from '@/stores/app-dev-workbench';

const mocks = vi.hoisted(() => ({
  restoreAppCheckpoint: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/app-dev-api', () => ({
  restoreAppCheckpoint: (...args: unknown[]) => mocks.restoreAppCheckpoint(...args),
}));
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mocks.toastSuccess(...args),
    error: (...args: unknown[]) => mocks.toastError(...args),
  },
}));

const WORKBENCH_DEFAULTS = {
  mode: 'preview',
  stageCollapsed: false,
  device: 'desktop',
  tuneMode: 'chat',
  diffRequest: null,
  versionRestoreRequest: null,
} as const;

describe('useAppDevVersionRestore（恢复版本请求-消费）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAppDevVersionsStore.setState({
      versionsByWorkspace: {
        'ws-1': {
          'turn-user-u1': {
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
    useAppDevWorkbenchStore.setState({ ...WORKBENCH_DEFAULTS });
  });

  it('消费 versionRestoreRequest：出现确认目标（label 取 checkpoint subject），请求被清空', async () => {
    const { result } = renderHook(() =>
      useAppDevVersionRestore({ workspaceId: 'ws-1', onRestored: vi.fn() }),
    );
    expect(result.current.target).toBeNull();

    act(() => {
      useAppDevWorkbenchStore.getState().setVersionRestoreRequest({ hash: 'hash-u1' });
    });

    await waitFor(() => {
      expect(result.current.target).toEqual({
        hash: 'hash-u1',
        label: '对话修改 · 把标题改蓝',
      });
    });
    expect(useAppDevWorkbenchStore.getState().versionRestoreRequest).toBeNull();
  });

  it('confirm 成功：restoreAppCheckpoint 带 hash 调用，触发 onRestored + 成功提示并关闭', async () => {
    mocks.restoreAppCheckpoint.mockResolvedValue({ restored: true, backupRef: 'sclaw-backup-1' });
    const onRestored = vi.fn();
    const { result } = renderHook(() =>
      useAppDevVersionRestore({ workspaceId: 'ws-1', onRestored }),
    );

    act(() => {
      useAppDevWorkbenchStore.getState().setVersionRestoreRequest({ hash: 'hash-u1' });
    });
    await waitFor(() => expect(result.current.target).not.toBeNull());

    await act(async () => {
      await result.current.confirm();
    });

    expect(mocks.restoreAppCheckpoint).toHaveBeenCalledWith('ws-1', 'hash-u1');
    expect(onRestored).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess).toHaveBeenCalled();
    expect(result.current.target).toBeNull();
  });

  it('confirm 失败：错误提示，不触发刷新，也关闭确认框', async () => {
    mocks.restoreAppCheckpoint.mockResolvedValue({ restored: false });
    const onRestored = vi.fn();
    const { result } = renderHook(() =>
      useAppDevVersionRestore({ workspaceId: 'ws-1', onRestored }),
    );

    act(() => {
      useAppDevWorkbenchStore.getState().setVersionRestoreRequest({ hash: 'hash-u1' });
    });
    await waitFor(() => expect(result.current.target).not.toBeNull());

    await act(async () => {
      await result.current.confirm();
    });

    expect(onRestored).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalled();
    expect(result.current.target).toBeNull();
  });

  it('confirm 抛异常（接口失败）：按失败处理不炸页面', async () => {
    mocks.restoreAppCheckpoint.mockRejectedValue(new Error('network down'));
    const onRestored = vi.fn();
    const { result } = renderHook(() =>
      useAppDevVersionRestore({ workspaceId: 'ws-1', onRestored }),
    );

    act(() => {
      useAppDevWorkbenchStore.getState().setVersionRestoreRequest({ hash: 'hash-u1' });
    });
    await waitFor(() => expect(result.current.target).not.toBeNull());

    await act(async () => {
      await result.current.confirm();
    });

    expect(onRestored).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalled();
  });

  it('cancel：直接关闭，不调用恢复接口', async () => {
    const { result } = renderHook(() =>
      useAppDevVersionRestore({ workspaceId: 'ws-1', onRestored: vi.fn() }),
    );
    act(() => {
      useAppDevWorkbenchStore.getState().setVersionRestoreRequest({ hash: 'hash-u1' });
    });
    await waitFor(() => expect(result.current.target).not.toBeNull());

    act(() => result.current.cancel());

    expect(result.current.target).toBeNull();
    expect(mocks.restoreAppCheckpoint).not.toHaveBeenCalled();
  });

  it('无映射记录时 label 退化为短 hash', async () => {
    const { result } = renderHook(() =>
      useAppDevVersionRestore({ workspaceId: 'ws-1', onRestored: vi.fn() }),
    );
    act(() => {
      useAppDevWorkbenchStore.getState().setVersionRestoreRequest({ hash: 'unknownhash123' });
    });
    await waitFor(() => {
      expect(result.current.target).toEqual({ hash: 'unknownhash123', label: 'unknown' });
    });
  });
});
