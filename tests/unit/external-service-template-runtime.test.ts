import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExternalServicesManifest } from '../../shared/external-service-contract';
import { createExternalServiceClient } from '../../resources/app-templates/site-minimal/src/sclaw/external-service-runtime';

const requestMock = vi.fn();
const manifest: ExternalServicesManifest = {
  schemaVersion: 'external-services/v1',
  services: [
    {
      alias: 'policyOntology',
      schemaVersion: 'external-service/v1',
      serviceId: 'sto-policy-ontology',
      version: '1.0.0',
      name: '策略本体服务',
      description: '',
      owner: 'policy-platform',
      environments: {
        daily: 'https://zc-hybrid-test.sto.cn/sto-policy/api',
        stage: 'https://zc-hybrid-stage.sto.cn/sto-policy/api',
        online: 'https://zc-hybrid.sto.cn/sto-policy/api',
      },
      auth: { type: 'stoToken' },
    },
    {
      alias: 'publicStatus',
      schemaVersion: 'external-service/v1',
      serviceId: 'public-status',
      version: '1.0.0',
      name: '公开服务',
      description: '',
      owner: 'platform',
      environments: {
        daily: 'https://status-test.sto.cn/api',
        stage: 'https://status-stage.sto.cn/api',
        online: 'https://status.sto.cn/api',
      },
      auth: { type: 'none' },
    },
  ],
};

describe('external service template runtime', () => {
  beforeEach(() => {
    requestMock.mockReset().mockResolvedValue({ ok: true });
    delete (window as unknown as { __SCLAW_APP_CONFIG__?: unknown }).__SCLAW_APP_CONFIG__;
    delete (window as unknown as { __STO_SSO_AUTH_CONFIG__?: unknown }).__STO_SSO_AUTH_CONFIG__;
  });

  it('本地始终使用 alias 代理路径', async () => {
    const client = createExternalServiceClient('policyOntology', {
      manifest,
      isDev: true,
      request: requestMock,
    });
    await client.request({ method: 'GET', path: '/v1/search' });
    expect(requestMock).toHaveBeenCalledWith('/proxy/policyOntology/v1/search', expect.anything());
  });

  it('发布时按注入 deployEnv 选择地址', async () => {
    (window as unknown as { __STO_SSO_AUTH_CONFIG__?: unknown }).__STO_SSO_AUTH_CONFIG__ = {
      deployEnv: 'stage',
    };
    const client = createExternalServiceClient('policyOntology', {
      manifest,
      isDev: false,
      request: requestMock,
    });
    await client.request({ method: 'GET', path: '/v1/search' });
    expect(requestMock).toHaveBeenCalledWith(
      'https://zc-hybrid-stage.sto.cn/sto-policy/api/v1/search',
      expect.anything(),
    );
  });

  it.each([
    ['app-test.sto.cn', 'https://zc-hybrid-test.sto.cn/sto-policy/api/v1/search'],
    ['app-pre.sto.cn', 'https://zc-hybrid-stage.sto.cn/sto-policy/api/v1/search'],
    ['app.sto.cn', 'https://zc-hybrid.sto.cn/sto-policy/api/v1/search'],
  ])('发布配置缺失时根据域名 %s 选择服务环境', async (hostname, expectedUrl) => {
    const client = createExternalServiceClient('policyOntology', {
      manifest,
      isDev: false,
      request: requestMock,
      hostname,
    });
    await client.request({ method: 'GET', path: '/v1/search' });
    expect(requestMock).toHaveBeenCalledWith(expectedUrl, expect.anything());
  });

  it('none 认证明确禁用 stoToken 且拒绝绝对 path', async () => {
    const client = createExternalServiceClient('publicStatus', {
      manifest,
      isDev: true,
      request: requestMock,
    });
    await client.request({ method: 'GET', path: '/health' });
    expect(requestMock).toHaveBeenCalledWith(
      '/proxy/publicStatus/health',
      expect.objectContaining({ stoToken: null }),
    );
    await expect(client.request({ method: 'GET', path: 'https://evil.example' }))
      .rejects.toThrow('相对路径');
  });
});
