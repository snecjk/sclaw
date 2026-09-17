import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getChannelConnection: vi.fn(),
  resolveSharedHubRefreshToken: vi.fn(),
  syncSharedHubRefreshToken: vi.fn(),
  revokeDingTalkHubBind: vi.fn(),
  getLocalDeviceId: vi.fn().mockResolvedValue('device-1'),
  hubBindStatus: vi.fn(),
  hubSyncChannels: vi.fn().mockResolvedValue({ refreshToken: null }),
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn(),
  getStatus: vi.fn().mockReturnValue({ state: 'idle', connected: false }),
  hasWeixinBotBound: vi.fn().mockReturnValue(false),
  weixinStart: vi.fn().mockResolvedValue(undefined),
  setGatewayManager: vi.fn(),
  resolveSclawHubBaseUrl: vi.fn().mockReturnValue('https://hub.example'),
}));

vi.mock('@electron/message-channel/hub/binding-service', () => ({
  getChannelConnection: mocks.getChannelConnection,
  resolveSharedHubRefreshToken: mocks.resolveSharedHubRefreshToken,
  syncSharedHubRefreshToken: mocks.syncSharedHubRefreshToken,
  revokeDingTalkHubBind: mocks.revokeDingTalkHubBind,
  getLocalDeviceId: mocks.getLocalDeviceId,
}));

vi.mock('@electron/message-channel/hub/hub-api', () => ({
  hubBindStatus: mocks.hubBindStatus,
  hubSyncChannels: mocks.hubSyncChannels,
}));

vi.mock('@electron/message-channel/hub/hub-client', () => ({
  getSclawHubClient: () => ({
    connect: mocks.connect,
    disconnect: mocks.disconnect,
    disconnectPermanently: mocks.disconnect,
    getStatus: mocks.getStatus,
    on: vi.fn(),
  }),
}));

vi.mock('@electron/message-channel/hub/hub-config', () => ({
  resolveSclawHubBaseUrl: mocks.resolveSclawHubBaseUrl,
}));

vi.mock('@electron/message-channel/hub/ingress', () => ({
  handleSclawInbound: vi.fn(),
  setChannelGatewayManager: vi.fn(),
}));

vi.mock('@electron/message-channel/weixin/binding', () => ({
  hasWeixinBotBound: mocks.hasWeixinBotBound,
}));

vi.mock('@electron/message-channel/weixin/service', () => ({
  getWeixinChannelService: () => ({
    setGatewayManager: mocks.setGatewayManager,
    start: mocks.weixinStart,
  }),
}));

describe('channel runtime bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveSclawHubBaseUrl.mockReturnValue('https://hub.example');
    mocks.hasWeixinBotBound.mockReturnValue(false);
    mocks.getStatus.mockReturnValue({ state: 'idle', connected: false });
    mocks.hubSyncChannels.mockResolvedValue({ refreshToken: null });
    mocks.connect.mockResolvedValue(undefined);
    mocks.weixinStart.mockResolvedValue(undefined);
  });

  it('probe: mobile-only bound+token → shouldAttempt true', async () => {
    mocks.getChannelConnection.mockImplementation(async (type: string) => {
      if (type === 'mobile') {
        return {
          bindStatus: 'bound',
          enabled: true,
          refreshToken: 'mob-tok',
          externalUserId: null,
        };
      }
      return null;
    });

    const { probeChannelRuntimeNeeds } = await import(
      '@electron/message-channel/hub/startup'
    );
    const plan = await probeChannelRuntimeNeeds();
    expect(plan.hub.shouldAttempt).toBe(true);
    expect(plan.hub.mobileBound).toBe(true);
    expect(plan.weixin.shouldStartWorker).toBe(false);
  });

  it('probe: mobile revoked with residual token → shouldAttempt false', async () => {
    mocks.getChannelConnection.mockImplementation(async (type: string) => {
      if (type === 'mobile') {
        return {
          bindStatus: 'revoked',
          enabled: false,
          refreshToken: 'stale-tok',
          externalUserId: null,
        };
      }
      return null;
    });

    const { probeChannelRuntimeNeeds } = await import(
      '@electron/message-channel/hub/startup'
    );
    const plan = await probeChannelRuntimeNeeds();
    expect(plan.hub.shouldAttempt).toBe(false);
  });

  it('ensure: skips weixin fork when no credentials; connects hub after sync when token present', async () => {
    mocks.getChannelConnection.mockImplementation(async (type: string) => {
      if (type === 'dingtalk') {
        return {
          bindStatus: 'bound',
          enabled: true,
          refreshToken: 'dt-tok',
          externalUserId: 'u1',
        };
      }
      return null;
    });
    mocks.hubBindStatus.mockResolvedValue({ bound: true, deviceId: 'device-1' });
    mocks.resolveSharedHubRefreshToken.mockResolvedValue('dt-tok');

    const { ensureChannelRuntimesReady } = await import(
      '@electron/message-channel/hub/startup'
    );
    await ensureChannelRuntimesReady(null);

    expect(mocks.weixinStart).not.toHaveBeenCalled();
    expect(mocks.connect).toHaveBeenCalledWith('dt-tok');
  });

  it('ensure: starts weixin when credentials exist; skips hub without usable token', async () => {
    mocks.getChannelConnection.mockResolvedValue(null);
    mocks.hasWeixinBotBound.mockReturnValue(true);
    mocks.resolveSharedHubRefreshToken.mockResolvedValue(null);

    const { ensureChannelRuntimesReady } = await import(
      '@electron/message-channel/hub/startup'
    );
    await ensureChannelRuntimesReady(null);

    await vi.waitFor(() => {
      expect(mocks.weixinStart).toHaveBeenCalled();
    });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('ensure: after remote unbound does not connect', async () => {
    mocks.getChannelConnection.mockImplementation(async (type: string) => {
      if (type === 'dingtalk') {
        return {
          bindStatus: 'bound',
          enabled: true,
          refreshToken: 'old-tok',
          externalUserId: 'u1',
        };
      }
      return null;
    });
    mocks.hubBindStatus.mockResolvedValue({ bound: false });
    mocks.resolveSharedHubRefreshToken.mockResolvedValue('should-not-use');

    const { ensureChannelRuntimesReady } = await import(
      '@electron/message-channel/hub/startup'
    );
    await ensureChannelRuntimesReady(null);

    expect(mocks.connect).not.toHaveBeenCalled();
  });
});
