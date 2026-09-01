import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppTemplateApiClient } from '../../electron/services/app-template-api-client';

const resolveBaseUrl = vi.fn().mockResolvedValue('https://memory.example.test');
const getAuthHeaders = vi.fn().mockResolvedValue({
  stotoken: 'token-1',
  Authorization: 'Bearer token-1',
});
const fetchImpl = vi.fn();

function client() {
  return new AppTemplateApiClient({ resolveBaseUrl, getAuthHeaders, fetchImpl });
}

describe('AppTemplateApiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('通过 resolveStoBaseUrl + 鉴权头查询模板', async () => {
    fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({
      success: true,
      errCode: '200',
      data: {
        items: [{
          templateId: 'site-minimal',
          pageType: 'site',
          name: '标准 Site 模版',
          description: '',
          status: 'ACTIVE',
          isBuiltin: true,
          latestVersion: '1.0.0',
          createdAt: '2026-08-26T00:00:00',
          updatedAt: '2026-08-26T00:00:00',
        }],
        total: 1,
        pageNum: 1,
        pageSize: 20,
      },
    }), { status: 200 }));

    const result = await client().page({ pageType: 'site', pageNum: 1, pageSize: 20 });

    expect(result.items[0]?.templateId).toBe('site-minimal');
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://memory.example.test/agent/v1/app-templates/page');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      stotoken: 'token-1',
      Authorization: 'Bearer token-1',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init.body))).toMatchObject({ pageType: 'site' });
  });

  it('发布模板使用 multipart，不能手工设置 Content-Type', async () => {
    fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({
      success: true,
      errCode: '200',
      data: {
        templateId: '01J00000000000000000000000',
        pageType: 'site',
        version: '1.0.0',
        status: 'ACTIVE',
        isBuiltin: false,
        packageOssKey: 'ai-memory-center/app-templates/site/01J00000000000000000000000/1.0.0/template.zip',
        packageEtag: 'etag-1',
        packageSize: 3,
        created: true,
      },
    }), { status: 200 }));

    await client().publish({
      metadata: {
        templateId: '01J00000000000000000000000',
        pageType: 'site',
        name: '业务模板',
        description: '',
      },
      packageBytes: new Uint8Array([1, 2, 3]),
    });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual({
      stotoken: 'token-1',
      Authorization: 'Bearer token-1',
    });
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(JSON.parse(String(form.get('metadata')))).toMatchObject({
      templateId: '01J00000000000000000000000',
    });
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('使用 memory-center 标准错误字段返回可读错误', async () => {
    fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({
      success: false,
      errCode: 'APP_TEMPLATE_INVALID',
      errMessage: '模板包不合法',
      traceId: 'trace-1',
    }), { status: 422 }));

    await expect(client().page({ pageType: 'site' })).rejects.toThrow(
      '模板包不合法 (APP_TEMPLATE_INVALID, traceId: trace-1)',
    );
  });
});
