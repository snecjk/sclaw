/**
 * 建站发布路由：不在本地用 gitlabProjectId 拦截。
 * 建站 HTTP 详情不返回该字段，仓库/状态由发布接口校验。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostApiContext } from '@electron/api/context';

const mocks = vi.hoisted(() => ({
  getWorkspaceRootPath: vi.fn(),
  sendJson: vi.fn(),
  resolveCloudAppForWorkspace: vi.fn(),
  pushStoApp: vi.fn(),
  getStoAppStatus: vi.fn(),
  getStoAppBindingByWorkspaceId: vi.fn(),
  ensureStoWorkspaceBinding: vi.fn(),
  assertExternalServicesReadyForDeploy: vi.fn(),
  ensureSiteAppActiveForDeploy: vi.fn(),
  createSiteAppDeploy: vi.fn(),
}));

vi.mock('@electron/services/app-dev-service', () => ({
  DEFAULT_APPS_PARENT_DIR: '/tmp/apps',
  createCheckpointDetailed: vi.fn(),
  diffCheckpoint: vi.fn(),
  restoreCheckpoint: vi.fn(),
  createUserApp: vi.fn(),
  cloneDevApp: vi.fn(),
  importUserApp: vi.fn(),
  ensureAppDevContext: vi.fn(),
  getAppDevStatus: vi.fn(),
  isGitAvailable: vi.fn(async () => true),
  listAppRoutes: vi.fn(async () => []),
  listAppSourceFiles: vi.fn(async () => []),
  listCheckpoints: vi.fn(async () => []),
  listDevAppWorkspaceIds: vi.fn(async () => []),
  listDevApps: vi.fn(async () => []),
  resolveCloudAppForWorkspace: (...args: unknown[]) => mocks.resolveCloudAppForWorkspace(...args),
  readAppSourceFile: vi.fn(),
  restartApp: vi.fn(),
  runSetupPipeline: vi.fn(),
  searchAppSourceFiles: vi.fn(async () => []),
  stopApp: vi.fn(),
  writeAppSourceFile: vi.fn(),
  installNpmPackage: vi.fn(),
  installPipPackage: vi.fn(),
  listAppDevAssistSkills: vi.fn(async () => []),
  installAppDevAssistSkill: vi.fn(),
  listAppDevPackageCatalog: vi.fn(async () => []),
  deleteDevApp: vi.fn(),
}));
vi.mock('@electron/services/session-catalog-service', () => ({
  getWorkspaceRootPath: (...args: unknown[]) => mocks.getWorkspaceRootPath(...args),
}));
vi.mock('@electron/api/route-utils', () => ({
  sendJson: (...args: unknown[]) => mocks.sendJson(...args),
  parseJsonBody: async (req: IncomingMessage) =>
    (req as unknown as { __body?: unknown }).__body ?? {},
}));
vi.mock('@electron/api/routes/app-dev-sso-auth', () => ({
  handleAppDevSsoAuthRoute: async () => false,
}));
vi.mock('@electron/services/sto-app-service', () => ({
  continueStoAppMerge: vi.fn(),
  getStoAppStatus: (...args: unknown[]) => mocks.getStoAppStatus(...args),
  pullStoApp: vi.fn(),
  pushStoApp: (...args: unknown[]) => mocks.pushStoApp(...args),
}));
vi.mock('@electron/services/sto-app-binding-store', () => ({
  getStoAppBindingByWorkspaceId: (...args: unknown[]) => mocks.getStoAppBindingByWorkspaceId(...args),
}));
vi.mock('@electron/services/code-collab-service', () => ({
  ensureStoWorkspaceBinding: (...args: unknown[]) => mocks.ensureStoWorkspaceBinding(...args),
}));
vi.mock('@electron/services/app-dev-deploy-preflight', () => ({
  assertExternalServicesReadyForDeploy: (...args: unknown[]) =>
    mocks.assertExternalServicesReadyForDeploy(...args),
}));
vi.mock('@electron/services/site-app-api', () => ({
  ensureSiteAppActiveForDeploy: (...args: unknown[]) => mocks.ensureSiteAppActiveForDeploy(...args),
  createSiteAppDeploy: (...args: unknown[]) => mocks.createSiteAppDeploy(...args),
  refreshSiteAppDeploy: vi.fn(),
  syncSiteAppMenus: vi.fn(),
}));

import { handleAppDevRoutes } from '@electron/api/routes/app-dev';

const ctx = {} as HostApiContext;
const res = {} as ServerResponse;

function jsonRequest(method: string, body?: unknown): IncomingMessage {
  return { method, __body: body } as unknown as IncomingMessage;
}

function lastSendJson(): { status: number; payload: Record<string, unknown> } {
  const call = mocks.sendJson.mock.calls.at(-1);
  return { status: call?.[1] as number, payload: call?.[2] as Record<string, unknown> };
}

describe('app-dev deploy routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWorkspaceRootPath.mockResolvedValue('/tmp/app');
    mocks.ensureStoWorkspaceBinding.mockResolvedValue(null);
    mocks.assertExternalServicesReadyForDeploy.mockResolvedValue(undefined);
    mocks.pushStoApp.mockResolvedValue({
      ok: true,
      output: '提交成功',
      json: { appCode: 'app_b7da864a44d2dea7', revisionId: 'rev-1', status: 'ready' },
    });
    mocks.getStoAppStatus.mockResolvedValue({
      syncState: 'synced',
      syncLabel: '已同步',
      appCode: 'app_b7da864a44d2dea7',
      bound: true,
    });
    mocks.getStoAppBindingByWorkspaceId.mockResolvedValue({
      appCode: 'app_b7da864a44d2dea7',
      applicationName: '测试建站',
    });
    mocks.ensureSiteAppActiveForDeploy.mockResolvedValue({
      appCode: 'app_b7da864a44d2dea7',
      status: 'active',
    });
    mocks.createSiteAppDeploy.mockResolvedValue({
      deployment_id: 'dep-1',
      app_code: 'app_b7da864a44d2dea7',
      env: 'daily',
      status: 'BUILDING',
    });
  });

  it('POST /sto-app/deploy：建站详情无 gitlabProjectId 时仍创建发布', async () => {
    mocks.resolveCloudAppForWorkspace.mockResolvedValue({
      appCode: 'app_b7da864a44d2dea7',
      applicationName: '测试建站',
      status: 'draft',
      previewUrl: 'https://page-test.sto.cn/ai-apps-test/app_b7da864a44d2dea7/index.html',
      pageType: 'site',
    });

    const handled = await handleAppDevRoutes(
      jsonRequest('POST', {
        workspaceId: 'ws-1',
        env: 'daily',
        appCode: 'app_b7da864a44d2dea7',
        requestId: 'req-1',
        deploymentVersion: '2026.09.08.1',
      }),
      res,
      new URL('http://localhost/api/app-dev/sto-app/deploy'),
      ctx,
    );

    expect(handled).toBe(true);
    expect(mocks.createSiteAppDeploy).toHaveBeenCalledWith({
      appCode: 'app_b7da864a44d2dea7',
      env: 'daily',
      requestId: 'req-1',
      deploymentVersion: '2026.09.08.1',
    });
    const { status, payload } = lastSendJson();
    expect(status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.appCode).toBe('app_b7da864a44d2dea7');
    expect(payload.env).toBe('daily');
  });
});
