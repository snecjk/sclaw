import { beforeEach, describe, expect, it, vi } from 'vitest';

const registryMocks = vi.hoisted(() => ({
  listEngineSessionRegistryEntries: vi.fn(),
}));

vi.mock('../../electron/engines/session-registry', () => ({
  deleteEngineSessionRegistryEntry: vi.fn(),
  getEngineSessionRegistryEntry: vi.fn(),
  listEngineSessionRegistryEntries: registryMocks.listEngineSessionRegistryEntries,
  upsertEngineSessionRegistryEntry: vi.fn(),
}));

import { piAdapter } from '../../electron/engines/pi-adapter';

describe('PI adapter session listing', () => {
  beforeEach(() => {
    registryMocks.listEngineSessionRegistryEntries.mockReset();
  });

  it('omits workflow node sessions while preserving user PI sessions', async () => {
    registryMocks.listEngineSessionRegistryEntries.mockResolvedValue([
      {
        sessionKey: 'pi:workflow:node-session', engineType: 'pi', agentId: 'main',
        title: 'internal node', model: 'model-a', updatedAt: 200,
      },
      {
        sessionKey: 'pi:main:user-session', engineType: 'pi', agentId: 'main',
        title: '用户会话', model: 'model-a', updatedAt: 100,
      },
    ]);

    const result = await piAdapter.listSessions({} as never);

    expect(result.success).toBe(true);
    expect(result.result?.sessions).toEqual([
      expect.objectContaining({ key: 'pi:main:user-session', engineType: 'pi' }),
    ]);
  });
});
