import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handleSso: vi.fn(),
  getWorkspaceRootPath: vi.fn(),
  getStoAppStatus: vi.fn(),
  siteappDeployResourceList: vi.fn(),
}));

vi.mock('../../electron/api/routes/app-dev-sso-auth', () => ({
  handleAppDevSsoAuthRoute: mocks.handleSso,
}));
vi.mock('../../electron/services/session-catalog-service', () => ({
  getWorkspaceRootPath: mocks.getWorkspaceRootPath,
}));
vi.mock('../../electron/services/sto-app-service', () => ({
  getStoAppStatus: mocks.getStoAppStatus,
}));
vi.mock('../../electron/utils/siteapp-cli', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../electron/utils/siteapp-cli')>(),
  siteappDeployResourceList: mocks.siteappDeployResourceList,
}));

function request(body: unknown): Readable & { method: string } {
  const req = Readable.from([JSON.stringify(body)]) as Readable & { method: string };
  req.method = 'POST';
  return req;
}

function response() {
  let payload = '';
  return {
    res: {
      statusCode: 0,
      setHeader: vi.fn(),
      end: vi.fn((chunk?: string) => { payload = chunk ?? ''; }),
    },
    json: () => JSON.parse(payload) as Record<string, unknown>,
  };
}

async function callRoute(body: unknown) {
  const { handleAppDevDeployResourceRoute } = await import('../../electron/api/routes/app-dev-deploy-resource');
  const target = response();
  const handled = await handleAppDevDeployResourceRoute(
    request(body) as never,
    target.res as never,
    new URL('http://localhost/api/app-dev/sto-app/deploy/resource/list'),
  );
  return { handled, statusCode: target.res.statusCode, json: target.json() };
}

describe('POST /api/app-dev/sto-app/deploy/resource/list', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.handleSso.mockResolvedValue(false);
    mocks.getWorkspaceRootPath.mockResolvedValue('/apps/demo');
    mocks.getStoAppStatus.mockResolvedValue({ appCode: 'app_from_workspace' });
    mocks.siteappDeployResourceList.mockResolvedValue({ ok: true, exitCode: 0, data: [] });
  });

  it('queries resources with an explicit app code', async () => {
    const result = await callRoute({
      workspaceId: 'ws-1',
      appCode: 'app_1',
      pipelineInstanceId: 5587,
    });

    expect(result).toEqual({
      handled: true,
      statusCode: 200,
      json: {
        success: true,
        appCode: 'app_1',
        pipelineInstanceId: 5587,
        data: [],
      },
    });
    expect(mocks.siteappDeployResourceList).toHaveBeenCalledWith({
      appCode: 'app_1',
      pipelineInstanceId: 5587,
    });
  });

  it('resolves app code from workspace status', async () => {
    const result = await callRoute({ workspaceId: 'ws-1', pipelineInstanceId: '5591' });

    expect(result.statusCode).toBe(200);
    expect(mocks.getStoAppStatus).toHaveBeenCalledWith('/apps/demo');
    expect(mocks.siteappDeployResourceList).toHaveBeenCalledWith({
      appCode: 'app_from_workspace',
      pipelineInstanceId: 5591,
    });
  });

  it.each([
    [{ appCode: 'app_1', pipelineInstanceId: 5587 }, '缺少 workspaceId'],
    [{ workspaceId: 'ws-1', appCode: 'app_1', pipelineInstanceId: 0 }, '缺少有效的 pipelineInstanceId'],
    [{ workspaceId: 'ws-1', appCode: 'app_1', pipelineInstanceId: 'bad' }, '缺少有效的 pipelineInstanceId'],
  ])('rejects invalid input', async (body, message) => {
    const result = await callRoute(body);
    expect(result.statusCode).toBe(500);
    expect(result.json).toMatchObject({ success: false, error: message });
    expect(mocks.siteappDeployResourceList).not.toHaveBeenCalled();
  });

  it('maps CLI failures through the siteapp error helper', async () => {
    mocks.siteappDeployResourceList.mockResolvedValue({
      ok: false,
      exitCode: 1,
      error: 'resource query failed',
    });

    const result = await callRoute({
      workspaceId: 'ws-1',
      appCode: 'app_1',
      pipelineInstanceId: 5587,
    });

    expect(result.statusCode).toBe(500);
    expect(result.json).toMatchObject({ success: false, error: 'resource query failed' });
  });
});
