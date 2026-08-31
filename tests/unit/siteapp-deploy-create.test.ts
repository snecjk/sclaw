import { describe, expect, it } from 'vitest';
import {
  buildDefaultDeploymentVersion,
  resolveSiteappDeployCreateParams,
} from '../../electron/utils/siteapp-cli';

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
