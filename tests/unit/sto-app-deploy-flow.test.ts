import { beforeEach, describe, expect, it, vi } from 'vitest';

const { deployStoAppMock, refreshStoAppDeployMock } = vi.hoisted(() => ({
  deployStoAppMock: vi.fn(),
  refreshStoAppDeployMock: vi.fn(),
}));

vi.mock('@/lib/app-dev-api', () => ({
  deployStoApp: deployStoAppMock,
  refreshStoAppDeploy: refreshStoAppDeployMock,
}));

import { runStoAppDeployFlow } from '../../src/lib/sto-app-deploy-flow';

describe('runStoAppDeployFlow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the shared deployment request independent of page type', async () => {
    deployStoAppMock.mockResolvedValue({
      success: true,
      appCode: 'app-1',
      env: 'daily',
      data: {
        deploymentId: 'dep-1',
        appCode: 'app-1',
        env: 'daily',
        status: 'SUCCESS',
      },
    });

    const outcome = await runStoAppDeployFlow({
      workspaceId: 'ws-1',
      env: 'daily',
      appCode: 'app-1',
      deploymentVersion: '1.4.0',
      appName: 'Demo',
    });

    expect(outcome.kind).toBe('success');
    expect(deployStoAppMock).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      env: 'daily',
      appCode: 'app-1',
      deploymentVersion: '1.4.0',
      pushMessage: '发布前同步: Demo (daily)',
    });
    expect(refreshStoAppDeployMock).not.toHaveBeenCalled();
  });

  it('polls refresh with deploymentId object and unwraps snake_case create payload', async () => {
    deployStoAppMock.mockResolvedValue({
      success: true,
      appCode: 'app-1',
      env: 'daily',
      data: {
        path: 'siteapp.deploy.create',
        result: {
          body: {
            data: {
              deployment_id: 'dep-1',
              app_code: 'app-1',
              env: 'daily',
              status: 'BUILDING',
            },
          },
        },
      },
    });
    refreshStoAppDeployMock.mockResolvedValue({
      success: true,
      deploymentId: 'dep-1',
      data: {
        path: 'siteapp.deploy.refresh',
        result: {
          body: {
            data: {
              deployment_id: 'dep-1',
              status: 'SUCCESS',
              env: 'daily',
            },
          },
        },
      },
    });

    const outcome = await runStoAppDeployFlow({
      workspaceId: 'ws-1',
      env: 'daily',
      appCode: 'app-1',
      appName: 'Demo',
    });

    expect(outcome.kind).toBe('success');
    expect(refreshStoAppDeployMock).toHaveBeenCalledWith({
      deploymentId: 'dep-1',
      workspaceId: 'ws-1',
      appCode: 'app-1',
    });
  });

  it('keeps polling when refresh reports failed with pending pipeline label', async () => {
    vi.useFakeTimers();
    deployStoAppMock.mockResolvedValue({
      success: true,
      appCode: 'app-1',
      env: 'daily',
      data: {
        deployment_id: 'dep-1',
        app_code: 'app-1',
        env: 'daily',
        status: 'failed',
        failure_message: '待执行',
        failure_stage: 'refresh_pipeline',
      },
    });
    refreshStoAppDeployMock
      .mockResolvedValueOnce({
        success: true,
        deploymentId: 'dep-1',
        data: {
          deployment_id: 'dep-1',
          status: 'failed',
          failure_message: '待执行',
        },
      })
      .mockResolvedValueOnce({
        success: true,
        deploymentId: 'dep-1',
        data: {
          deployment_id: 'dep-1',
          status: 'SUCCESS',
          env: 'daily',
        },
      });

    const outcomePromise = runStoAppDeployFlow({
      workspaceId: 'ws-1',
      env: 'daily',
      appCode: 'app-1',
    });
    await vi.advanceTimersByTimeAsync(4_000);
    await vi.advanceTimersByTimeAsync(4_000);
    const outcome = await outcomePromise;
    expect(outcome.kind).toBe('success');
    expect(refreshStoAppDeployMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
