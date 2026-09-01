import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hostApiFetch } from '@/lib/host-api';
import {
  pageExternalServices,
  publishExternalService,
  saveExternalServiceDraft,
} from '@/lib/external-service-api';

vi.mock('@/lib/host-api', () => ({ hostApiFetch: vi.fn() }));

const mockedFetch = vi.mocked(hostApiFetch);

describe('external service renderer api', () => {
  beforeEach(() => mockedFetch.mockReset());

  it('通过 ai-memory 通用代理查询服务', async () => {
    mockedFetch.mockResolvedValueOnce({
      success: true,
      data: { items: [], total: 0, pageNum: 1, pageSize: 20 },
    });

    await pageExternalServices({ keyword: 'policy' });

    expect(mockedFetch).toHaveBeenCalledWith(
      '/ai-memory/agent/v1/external-services/page',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('保存草稿和发布严格使用 memory-center 契约', async () => {
    mockedFetch.mockResolvedValue({ success: true, data: { serviceId: 'policy' } });
    const draft = {
      name: '策略服务',
      description: '',
      owner: 'policy-platform',
      environments: {
        daily: 'https://daily.sto.cn/api',
        stage: 'https://stage.sto.cn/api',
        online: 'https://online.sto.cn/api',
      },
      auth: { type: 'stoToken' as const },
    };

    await saveExternalServiceDraft('policy', draft);
    await publishExternalService('policy');

    expect(mockedFetch).toHaveBeenNthCalledWith(
      1,
      '/ai-memory/agent/v1/external-services/policy/draft',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify(draft) }),
    );
    expect(mockedFetch).toHaveBeenNthCalledWith(
      2,
      '/ai-memory/agent/v1/external-services/policy/publish',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
