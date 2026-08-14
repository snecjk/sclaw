import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/host-api', () => ({ hostApiFetch: vi.fn() }));

import { hostApiFetch } from '@/lib/host-api';
import { applySessionModel } from '@/lib/sync-workspace-default-to-chat';
import { useProviderStore } from '@/stores/providers';

describe('Pi session model switching', () => {
  beforeEach(() => {
    vi.mocked(hostApiFetch).mockReset();
    useProviderStore.setState({
      accounts: [{
        id: 'openai-main',
        vendorId: 'openai',
        name: 'OpenAI',
        enabled: true,
        authMode: 'api-key',
        model: 'gpt-5.2',
      }],
    });
  });

  it('persists a Pi model override with engineType=pi', async () => {
    vi.mocked(hostApiFetch).mockResolvedValue({
      success: true,
      modelOverride: 'gpt-5.2',
    });

    await expect(applySessionModel({
      currentSessionKey: 'pi:main:session-1',
      modelId: 'gpt-5.2',
      accountId: 'openai-main',
      currentAgentId: 'main',
      engineType: 'pi',
    })).resolves.toBe('gpt-5.2');

    expect(hostApiFetch).toHaveBeenCalledWith('/api/sessions/model', {
      method: 'POST',
      body: JSON.stringify({
        sessionKey: 'pi:main:session-1',
        model: 'gpt-5.2',
        accountId: 'openai-main',
        agentId: 'main',
        engineType: 'pi',
      }),
    });
  });
});
