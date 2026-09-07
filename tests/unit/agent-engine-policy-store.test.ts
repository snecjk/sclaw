import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

import {
  normalizeAgentEnginePolicy,
  useAgentEnginePolicyStore,
} from '@/stores/agent-engine-policy';

describe('agent engine policy store', () => {
  beforeEach(() => {
    hostApiFetchMock.mockReset();
    useAgentEnginePolicyStore.getState().reset();
  });

  it('filters unknown and duplicate engines, then follows server order', () => {
    const policy = normalizeAgentEnginePolicy({
      engines: [
        { code: 'pi', name: 'Pi', order: 20 },
        { code: 'unknown', name: 'Unknown', order: 1 },
        { code: 'claude', name: '', order: 10 },
        { code: 'pi', name: 'Duplicate', order: 30 },
      ],
      defaultEngine: 'unknown',
      matchedBy: 'department',
      configVersion: 'v1',
    });

    expect(policy.engines.map((item) => item.code)).toEqual(['claude', 'pi']);
    expect(policy.engines[0].name).toBe('Claude Agent');
    expect(policy.defaultEngine).toBe('claude');
    expect(policy.matchedBy).toBe('department');
  });

  it('loads the effective policy through the memory-center proxy', async () => {
    hostApiFetchMock.mockResolvedValue({
      success: true,
      data: {
        engines: [{ code: 'pi', name: 'Pi Agent', order: 10 }],
        defaultEngine: 'pi',
        matchedBy: 'user',
        configVersion: 'v2',
      },
    });

    await useAgentEnginePolicyStore.getState().fetchPolicy('employee-1');

    expect(hostApiFetchMock).toHaveBeenCalledWith(
      '/ai-memory/agent/v1/client-config/agent-engines',
    );
    expect(useAgentEnginePolicyStore.getState()).toMatchObject({
      ownerCode: 'employee-1',
      loaded: true,
      loading: false,
      defaultEngine: 'pi',
      matchedBy: 'user',
      configVersion: 'v2',
      error: null,
    });
  });

  it('falls back to the legacy options when the first request fails', async () => {
    hostApiFetchMock.mockRejectedValue(new Error('offline'));

    await useAgentEnginePolicyStore.getState().fetchPolicy('employee-2');

    const state = useAgentEnginePolicyStore.getState();
    expect(state.engines.map((item) => item.code)).toEqual(['openclaw', 'claude', 'pi']);
    expect(state.loaded).toBe(true);
    expect(state.error).toBe('offline');
  });

  it('reuses the policy for 20 minutes and refreshes it after expiry', async () => {
    let now = 1_800_000_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    hostApiFetchMock.mockResolvedValue({
      success: true,
      data: {
        engines: [{ code: 'openclaw', name: 'OpenClaw', order: 10 }],
        defaultEngine: 'openclaw',
      },
    });

    try {
      await useAgentEnginePolicyStore.getState().fetchPolicy('employee-cache');
      now += 19 * 60 * 1000;
      await useAgentEnginePolicyStore.getState().fetchPolicy('employee-cache');
      expect(hostApiFetchMock).toHaveBeenCalledTimes(1);

      now += 60 * 1000 + 1;
      await useAgentEnginePolicyStore.getState().fetchPolicy('employee-cache');
      expect(hostApiFetchMock).toHaveBeenCalledTimes(2);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
