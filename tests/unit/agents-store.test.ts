import { beforeEach, describe, expect, it, vi } from 'vitest';

const { hostApiFetchMock } = vi.hoisted(() => ({
  hostApiFetchMock: vi.fn(),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: hostApiFetchMock,
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: {
    getState: () => ({ user: { code: 'user-001' } }),
  },
}));

describe('agents store engine policy reuse', () => {
  beforeEach(() => {
    vi.resetModules();
    hostApiFetchMock.mockReset();
  });

  it('reuses the loaded engine policy when creating an Agent', async () => {
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/ai-memory/agent/v1/client-config/agent-engines') {
        return {
          success: true,
          data: {
            engines: [{ code: 'pi', name: 'Pi', order: 10 }],
            defaultEngine: 'pi',
          },
        };
      }
      if (path === '/api/agents') {
        return {
          success: true,
          agents: [],
          defaultAgentId: 'main',
          configuredChannelTypes: [],
          channelOwners: {},
          channelAccountOwners: {},
        };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    const { useAgentEnginePolicyStore } = await import('@/stores/agent-engine-policy');
    const { useAgentsStore } = await import('@/stores/agents');

    await useAgentEnginePolicyStore.getState().fetchPolicy('user-001');
    await useAgentsStore.getState().createAgent('Research');

    const policyCalls = hostApiFetchMock.mock.calls.filter(
      ([path]) => path === '/ai-memory/agent/v1/client-config/agent-engines',
    );
    expect(policyCalls).toHaveLength(1);

    const createCall = hostApiFetchMock.mock.calls.find(([path]) => path === '/api/agents');
    expect(JSON.parse(createCall?.[1]?.body as string)).toMatchObject({ defaultEngine: 'pi' });
  });
});
