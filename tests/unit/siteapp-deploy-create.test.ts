import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runSaiMock } = vi.hoisted(() => ({ runSaiMock: vi.fn() }));

vi.mock('../../electron/utils/sai-cli', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../electron/utils/sai-cli')>(),
  runSai: runSaiMock,
}));
import {
  buildDefaultDeploymentVersion,
  resolveSiteappDeployCreateParams,
  siteappDeployResourceList,
} from '../../electron/utils/siteapp-cli';

beforeEach(() => {
  runSaiMock.mockReset();
  runSaiMock.mockResolvedValue({ ok: true, exitCode: 0, data: [] });
});

describe('siteapp deploy create params', () => {
  it('fills required request_id and deployment_version when omitted', () => {
    const params = resolveSiteappDeployCreateParams({
      appCode: 'app_test',
      env: 'daily',
    });
    expect(params.app_code).toBe('app_test');
    expect(params.env).toBe('daily');
    expect(params.request_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(params.deployment_version).toMatch(/^\d{4}\.\d{2}\.\d{2}\.\d{6}$/);
  });

  it('keeps caller-provided ids and versions', () => {
    const params = resolveSiteappDeployCreateParams({
      appCode: 'app_test',
      env: 'stage',
      requestId: 'request-1',
      deploymentVersion: '2026.08.28.1',
    });
    expect(params).toEqual({
      app_code: 'app_test',
      env: 'stage',
      request_id: 'request-1',
      deployment_version: '2026.08.28.1',
    });
  });

  it('builds deployment version from timestamp', () => {
    expect(buildDefaultDeploymentVersion(new Date('2026-08-31T13:20:45+08:00'))).toBe('2026.08.31.132045');
  });
});

describe('siteapp deploy-resource list', () => {
  it('calls the registered three-segment command with normalized params', async () => {
    await siteappDeployResourceList({ appCode: ' app_1 ', pipelineInstanceId: '5587' });

    expect(runSaiMock).toHaveBeenCalledWith([
      'siteapp',
      'deploy-resource',
      'list',
      '--params',
      JSON.stringify({ app_code: 'app_1', pipeline_instance_id: 5587 }),
      '-f',
      'json',
    ], expect.any(Number));
  });

  it.each([
    { appCode: '', pipelineInstanceId: 5587 },
    { appCode: 'app_1', pipelineInstanceId: 0 },
    { appCode: 'app_1', pipelineInstanceId: 'bad' },
  ])('rejects invalid input without invoking sai-cli', async (input) => {
    const result = await siteappDeployResourceList(input);
    expect(result.ok).toBe(false);
    expect(runSaiMock).not.toHaveBeenCalled();
  });
});
