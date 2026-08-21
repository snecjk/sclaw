import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getStoAppStatusMock, runStoAppDeployFlowMock } = vi.hoisted(() => ({
  getStoAppStatusMock: vi.fn(),
  runStoAppDeployFlowMock: vi.fn(),
}));

vi.mock('@/lib/app-dev-api', () => ({
  getStoAppStatus: getStoAppStatusMock,
}));

vi.mock('@/lib/sto-app-deploy-flow', () => ({
  runStoAppDeployFlow: runStoAppDeployFlowMock,
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
      applicationId: 'app-1',
      appName: 'Demo',
    }));

    act(() => result.current.start({ env: 'daily', deploymentVersion: '1.4.0' }));

    await waitFor(() => expect(result.current.job?.phase).toBe('success'));
    expect(result.current.job?.data).toEqual(data);
    expect(result.current.job?.fields.resourcePages).toEqual(data.resourcePages);
  });
});
