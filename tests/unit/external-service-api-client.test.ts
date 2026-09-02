import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExternalServiceApiClient } from '../../electron/services/external-service-api-client';

const resolveBaseUrl = vi.fn().mockResolvedValue('https://memory.example.test');
const getAuthHeaders = vi.fn().mockResolvedValue({ stotoken: 'token-1' });
const fetchImpl = vi.fn();

describe('ExternalServiceApiClient', () => {
  beforeEach(() => vi.clearAllMocks());

  it('使用 resolveStoBaseUrl 和鉴权头搜索服务', async () => {
    fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({
      success: true,
      data: {
        items: [{ serviceId: 'sto-policy-ontology', latestVersion: '1.0.0' }],
        total: 1,
        pageNum: 1,
        pageSize: 20,
      },
    }), { status: 200 }));
    const client = new ExternalServiceApiClient({ resolveBaseUrl, getAuthHeaders, fetchImpl });

    const result = await client.page({ keyword: 'ontology' });

    expect(result.items[0]?.serviceId).toBe('sto-policy-ontology');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://memory.example.test/agent/v1/external-services/page',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ stotoken: 'token-1' }),
      }),
    );
  });

  it('保留 memory-center 错误码和 traceId', async () => {
    fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({
      success: false,
      errCode: 'EXTERNAL_SERVICE_NOT_FOUND',
      errMessage: '外部服务不存在',
      traceId: 'trace-1',
    }), { status: 404 }));
    const client = new ExternalServiceApiClient({ resolveBaseUrl, getAuthHeaders, fetchImpl });

    await expect(client.getVersion('missing', '1.0.0')).rejects.toThrow(
      '外部服务不存在 (EXTERNAL_SERVICE_NOT_FOUND, traceId: trace-1)',
    );
  });
});
