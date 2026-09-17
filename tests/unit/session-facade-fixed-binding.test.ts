import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findBySessionKeyMock,
  getLatestChannelCatalogSessionMock,
  getEngineSessionRegistryEntryMock,
  rememberSessionEngineTypeMock,
  ensureCatalogSessionInDefaultWorkspaceMock,
  upsertCatalogSessionMock,
  getSettingMock,
  getChannelConnectionMock,
} = vi.hoisted(() => ({
  findBySessionKeyMock: vi.fn(),
  getLatestChannelCatalogSessionMock: vi.fn(),
  getEngineSessionRegistryEntryMock: vi.fn(),
  rememberSessionEngineTypeMock: vi.fn(),
  ensureCatalogSessionInDefaultWorkspaceMock: vi.fn(),
  upsertCatalogSessionMock: vi.fn(),
  getSettingMock: vi.fn(),
  getChannelConnectionMock: vi.fn(),
}));

vi.mock('../../electron/db/repositories/catalog-session-repository', () => ({
  getCatalogSessionRepository: () => ({
    findBySessionKey: (...args: unknown[]) => findBySessionKeyMock(...args),
  }),
}));

vi.mock('../../electron/services/session-catalog-service', () => ({
  getLatestChannelCatalogSession: (...args: unknown[]) => getLatestChannelCatalogSessionMock(...args),
  ensureCatalogSessionInDefaultWorkspace: (...args: unknown[]) =>
    ensureCatalogSessionInDefaultWorkspaceMock(...args),
  upsertCatalogSession: (...args: unknown[]) => upsertCatalogSessionMock(...args),
}));

vi.mock('../../electron/engines/session-registry', () => ({
  getEngineSessionRegistryEntry: (...args: unknown[]) => getEngineSessionRegistryEntryMock(...args),
}));

vi.mock('../../electron/engines/session-engine', () => ({
  rememberSessionEngineType: (...args: unknown[]) => rememberSessionEngineTypeMock(...args),
}));

vi.mock('../../electron/utils/store', () => ({
  getSetting: (...args: unknown[]) => getSettingMock(...args),
}));

vi.mock('../../electron/message-channel/hub/binding-service', () => ({
  FIXED_CHANNEL_BINDING: { engineType: 'pi', agentId: 'main' },
  getChannelConnection: (...args: unknown[]) => getChannelConnectionMock(...args),
}));

vi.mock('../../electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('createOrGetSession fixed-engine gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettingMock.mockImplementation(async (key: string) => {
      if (key === 'channelSessionIdleEnabled') return true;
      if (key === 'channelSessionIdleHours') return 24;
      return undefined;
    });
    ensureCatalogSessionInDefaultWorkspaceMock.mockResolvedValue(undefined);
    upsertCatalogSessionMock.mockResolvedValue(undefined);
    rememberSessionEngineTypeMock.mockResolvedValue(undefined);
  });

  it('mobile: reuses requestedKey when registry engine is pi', async () => {
    const key = 'agent:main:mobile:peer1:20260723100000:abcd';
    findBySessionKeyMock.mockResolvedValue({
      sessionKey: key,
      channelType: 'mobile',
      deletedAt: null,
    });
    getEngineSessionRegistryEntryMock.mockResolvedValue({ engineType: 'pi' });

    const { createOrGetSession } = await import(
      '../../electron/message-channel/common/session-facade'
    );
    const handle = await createOrGetSession({
      agentId: 'main',
      channelType: 'mobile',
      peerId: 'peer1',
      engineType: 'pi',
      sessionKey: key,
    });

    expect(handle.sessionKey).toBe(key);
    expect(getLatestChannelCatalogSessionMock).not.toHaveBeenCalled();
  });

  it('mobile: claude registry forces new key and does not reuse latest', async () => {
    const requested = 'agent:main:mobile:peer1:20260723100000:abcd';
    const latest = 'agent:main:mobile:peer1:20260722100000:zzzz';
    findBySessionKeyMock.mockResolvedValue({
      sessionKey: requested,
      channelType: 'mobile',
      deletedAt: null,
    });
    getEngineSessionRegistryEntryMock.mockResolvedValue({ engineType: 'claude' });
    getLatestChannelCatalogSessionMock.mockResolvedValue({
      sessionKey: latest,
      lastActivityAt: new Date().toISOString(),
    });

    const { createOrGetSession } = await import(
      '../../electron/message-channel/common/session-facade'
    );
    const handle = await createOrGetSession({
      agentId: 'main',
      channelType: 'mobile',
      peerId: 'peer1',
      engineType: 'pi',
      sessionKey: requested,
    });

    expect(handle.sessionKey).not.toBe(requested);
    expect(handle.sessionKey).not.toBe(latest);
    expect(handle.sessionKey).toMatch(/^agent:main:mobile:peer1:/);
  });

  it('mobile: missing registry forces new key (not latest)', async () => {
    const requested = 'agent:main:mobile:peer1:20260723100000:abcd';
    const latest = 'agent:main:mobile:peer1:20260722100000:zzzz';
    findBySessionKeyMock.mockResolvedValue({
      sessionKey: requested,
      channelType: 'mobile',
      deletedAt: null,
    });
    getEngineSessionRegistryEntryMock.mockResolvedValue(null);
    getLatestChannelCatalogSessionMock.mockResolvedValue({
      sessionKey: latest,
      lastActivityAt: new Date().toISOString(),
    });

    const { createOrGetSession } = await import(
      '../../electron/message-channel/common/session-facade'
    );
    const handle = await createOrGetSession({
      agentId: 'main',
      channelType: 'mobile',
      peerId: 'peer1',
      engineType: 'pi',
      sessionKey: requested,
    });

    expect(handle.sessionKey).not.toBe(requested);
    expect(handle.sessionKey).not.toBe(latest);
  });

  it('dingtalk: strategy C forceNew when registry is claude and bound is pi', async () => {
    const latest = 'agent:main:dingtalk:peer1:20260722100000:zzzz';
    getLatestChannelCatalogSessionMock.mockResolvedValue({
      sessionKey: latest,
      lastActivityAt: new Date().toISOString(),
    });
    getEngineSessionRegistryEntryMock.mockResolvedValue({ engineType: 'claude' });

    const { createOrGetSession } = await import(
      '../../electron/message-channel/common/session-facade'
    );
    const handle = await createOrGetSession({
      agentId: 'main',
      channelType: 'dingtalk',
      peerId: 'peer1',
      engineType: 'pi',
    });

    expect(handle.sessionKey).not.toBe(latest);
  });

  it('dingtalk: legacy openclaw registry forces new session', async () => {
    const latest = 'agent:main:dingtalk:peer1:20260722100000:zzzz';
    getLatestChannelCatalogSessionMock.mockResolvedValue({
      sessionKey: latest,
      lastActivityAt: new Date().toISOString(),
    });
    getEngineSessionRegistryEntryMock.mockResolvedValue({ engineType: 'openclaw' });

    const { createOrGetSession } = await import(
      '../../electron/message-channel/common/session-facade'
    );
    const handle = await createOrGetSession({
      agentId: 'main',
      channelType: 'dingtalk',
      peerId: 'peer1',
      engineType: 'pi',
    });

    expect(handle.sessionKey).not.toBe(latest);
  });

  it('createOrGetSession ignores openclaw engineType input and uses fixed pi', async () => {
    getLatestChannelCatalogSessionMock.mockResolvedValue(null);

    const { createOrGetSession } = await import(
      '../../electron/message-channel/common/session-facade'
    );
    const handle = await createOrGetSession({
      agentId: 'main',
      channelType: 'dingtalk',
      peerId: 'peer1',
      engineType: 'openclaw',
    });

    expect(handle.engineType).toBe('pi');
  });

  it('resolveChannelBinding returns fixed pi+main for bound hub channel', async () => {
    getChannelConnectionMock.mockResolvedValue({
      bindStatus: 'bound',
      engineType: 'claude',
      agentId: 'other',
    });

    const { resolveChannelBinding } = await import(
      '../../electron/message-channel/common/session-facade'
    );
    await expect(resolveChannelBinding('dingtalk')).resolves.toEqual({
      agentId: 'main',
      engineType: 'pi',
    });
  });
});
