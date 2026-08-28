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
      applicationId: 'app-1',
      env: 'daily',
      data: {
        deploymentId: 'dep-1',
        applicationId: 'app-1',
        env: 'daily',
        status: 'SUCCESS',
      },
    });

    const outcome = await runStoAppDeployFlow({
      workspaceId: 'ws-1',
      env: 'daily',
      applicationId: 'app-1',
      deploymentVersion: '1.4.0',
      appName: 'Demo',
    });

    expect(outcome.kind).toBe('success');
    expect(deployStoAppMock).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      env: 'daily',
      applicationId: 'app-1',
      deploymentVersion: '1.4.0',
      pushMessage: '发布前同步: Demo (daily)',
    });
    expect(refreshStoAppDeployMock).not.toHaveBeenCalled();
  });
});
