import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendJson: vi.fn(),
  disableMobileAppBind: vi.fn(),
  revokeDingTalkHubBind: vi.fn(),
  getChannelConnection: vi.fn(),
  hubDisableChannel: vi.fn(),
  hubUnbindRemote: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: vi.fn(),
  sendJson: mocks.sendJson,
}));

vi.mock('@electron/message-channel/hub/binding-service', () => ({
  disableMobileAppBind: mocks.disableMobileAppBind,
  enableMobileAppBind: vi.fn(),
  getChannelConnection: mocks.getChannelConnection,
  getLocalDeviceId: vi.fn(),
  revokeDingTalkHubBind: mocks.revokeDingTalkHubBind,
  syncSharedHubRefreshToken: vi.fn(),
  updateDingTalkBindingAgent: vi.fn(),
  updateMobileBindingAgent: vi.fn(),
  upsertDingTalkHubBind: vi.fn(),
}));

vi.mock('@electron/message-channel/hub/hub-api', () => ({
  hubBindStatus: vi.fn(),
  hubClaimBind: vi.fn(),
  hubCreateBind: vi.fn(),
  hubDisableChannel: mocks.hubDisableChannel,
  hubPollBind: vi.fn(),
  hubRegisterDesktop: vi.fn(),
  hubUnbindRemote: mocks.hubUnbindRemote,
}));

vi.mock('@electron/message-channel/hub/hub-client', () => ({
  getSclawHubClient: () => ({
    disconnect: mocks.disconnect,
    getStatus: () => ({ connected: true }),
  }),
}));

vi.mock('@electron/message-channel/hub/hub-config', () => ({
  resolveSclawHubBaseUrl: () => 'https://hub.example.test',
}));

vi.mock('@electron/message-channel/hub/ingress', () => ({ setChannelGatewayManager: vi.fn() }));
vi.mock('@electron/message-channel/hub/startup', () => ({ wireSclawInboundListener: vi.fn() }));
vi.mock('@electron/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

describe('channel hub independent bindings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('disables mobile remotely before local state and keeps the shared WS for bound dingtalk', async () => {
    const order: string[] = [];
    mocks.hubDisableChannel.mockImplementation(async () => { order.push('remote'); });
    mocks.disableMobileAppBind.mockImplementation(async () => { order.push('local'); });
    mocks.getChannelConnection.mockResolvedValue({ bindStatus: 'bound' });
    const { handleChannelHubRoutes } = await import('@electron/message-channel/hub/routes');

    const handled = await handleChannelHubRoutes(
      { method: 'POST' } as never,
      {} as never,
      new URL('http://localhost/api/channels/hub/mobile/bind/disable'),
      { gatewayManager: {} } as never,
    );

    expect(handled).toBe(true);
    expect(order).toEqual(['remote', 'local']);
    expect(mocks.hubDisableChannel).toHaveBeenCalledWith('mobile');
    expect(mocks.disconnect).not.toHaveBeenCalled();
    expect(mocks.sendJson).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({ success: true }));
  });

  it('disables dingtalk only and keeps the shared WS for bound mobile', async () => {
    mocks.getChannelConnection.mockResolvedValue({ bindStatus: 'bound' });
    const { handleChannelHubRoutes } = await import('@electron/message-channel/hub/routes');

    await handleChannelHubRoutes(
      { method: 'POST' } as never,
      {} as never,
      new URL('http://localhost/api/channels/hub/dingtalk/bind/unbind'),
      { gatewayManager: {} } as never,
    );

    expect(mocks.hubUnbindRemote).toHaveBeenCalledOnce();
    expect(mocks.revokeDingTalkHubBind).toHaveBeenCalledOnce();
    expect(mocks.disconnect).not.toHaveBeenCalled();
  });

  it('does not mutate local mobile state when the Hub disable fails', async () => {
    mocks.hubDisableChannel.mockRejectedValue(new Error('hub unavailable'));
    const { handleChannelHubRoutes } = await import('@electron/message-channel/hub/routes');

    await handleChannelHubRoutes(
      { method: 'POST' } as never,
      {} as never,
      new URL('http://localhost/api/channels/hub/mobile/bind/disable'),
      { gatewayManager: {} } as never,
    );

    expect(mocks.disableMobileAppBind).not.toHaveBeenCalled();
    expect(mocks.sendJson).toHaveBeenCalledWith(
      expect.anything(),
      500,
      expect.objectContaining({ success: false }),
    );
  });
});
