import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getStoAppStatusMock,
  listStoAppDeployHistoryMock,
  upsertStoAppDeployHistoryMock,
  runStoAppDeployFlowMock,
  pollDeployUntilTerminalMock,
} = vi.hoisted(() => ({
  getStoAppStatusMock: vi.fn(),
  listStoAppDeployHistoryMock: vi.fn(),
  upsertStoAppDeployHistoryMock: vi.fn(),
  runStoAppDeployFlowMock: vi.fn(),
  pollDeployUntilTerminalMock: vi.fn(),
}));

vi.mock('@/lib/app-dev-api', () => ({
  getStoAppStatus: getStoAppStatusMock,
  listStoAppDeployHistory: listStoAppDeployHistoryMock,
  upsertStoAppDeployHistory: upsertStoAppDeployHistoryMock,
}));

vi.mock('@/lib/sto-app-deploy-flow', () => ({
  runStoAppDeployFlow: runStoAppDeployFlowMock,
  pollDeployUntilTerminal: pollDeployUntilTerminalMock,
  describeStoAppDeployOutcome: () => '发布成功',
}));

vi.mock('sonner', () => ({
  toast: { message: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

import { useStoAppDeploy } from '../../src/hooks/use-sto-app-deploy';

describe('useStoAppDeploy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStoAppStatusMock.mockResolvedValue(null);
    listStoAppDeployHistoryMock.mockResolvedValue([]);
    upsertStoAppDeployHistoryMock.mockImplementation(async (_workspaceId: string, record: unknown) => [record]);
    pollDeployUntilTerminalMock.mockResolvedValue({
      kind: 'success',
      fields: { deploymentId: 'dep_resume', status: 'SUCCESS' },
      data: {},
    });
  });

  it('retains the raw successful deployment response for presentation', async () => {
    const data = {
      deploymentId: 'dep-1',
      status: 'SUCCESS',
      resourcePages: [{ artifactUrl: 'https://oss.example.cn/app/1.4.0/' }],
    };
    runStoAppDeployFlowMock.mockResolvedValue({
      kind: 'success',
      fields: data,
      data,
    });

    const { result } = renderHook(() => useStoAppDeploy({
      workspaceId: 'ws-1',
      appCode: 'app-1',
      appName: 'Demo',
    }));

    await waitFor(() => expect(listStoAppDeployHistoryMock).toHaveBeenCalled());

    act(() => result.current.start({ env: 'daily', deploymentVersion: '1.4.0' }));

    await waitFor(() => expect(result.current.job?.phase).toBe('success'));
    expect(result.current.job?.data).toEqual(data);
    expect(result.current.job?.fields.resourcePages).toEqual(data.resourcePages);
    await waitFor(() => expect(upsertStoAppDeployHistoryMock).toHaveBeenCalled());
  });

  it('opens the post-deploy success callback after a successful deploy', async () => {
    const onSuccess = vi.fn();
    runStoAppDeployFlowMock.mockResolvedValue({
      kind: 'success',
      fields: { applicationId: 'app-1', env: 'daily', status: 'SUCCESS', deploymentId: 'dep-2' },
      data: { status: 'SUCCESS' },
    });

    const { result } = renderHook(() => useStoAppDeploy({
      workspaceId: 'ws-1',
      appCode: 'app-1',
      appName: 'Demo',
      pageType: 'site',
      onSuccess,
    }));

    await waitFor(() => expect(listStoAppDeployHistoryMock).toHaveBeenCalled());
    act(() => result.current.start({ env: 'daily' }));
    await waitFor(() => expect(result.current.job?.phase).toBe('success'));
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('resumes polling an in-progress local publish record', async () => {
    listStoAppDeployHistoryMock.mockResolvedValue([{
      deploymentId: 'dep_resume',
      appCode: 'app-1',
      env: 'daily',
      status: 'BUILDING',
      startedAt: 10,
      updatedAt: 11,
    }]);

    const { result } = renderHook(() => useStoAppDeploy({
      workspaceId: 'ws-1',
      appCode: 'app-1',
      appName: 'Demo',
    }));

    await waitFor(() => expect(pollDeployUntilTerminalMock).toHaveBeenCalledWith(
      'dep_resume',
      expect.objectContaining({ workspaceId: 'ws-1' }),
    ));
    await waitFor(() => expect(result.current.job?.phase).toBe('success'));
    expect(result.current.running).toBe(false);
  });
});
