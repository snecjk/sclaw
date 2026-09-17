import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const parseJsonBodyMock = vi.fn();
const sendJsonMock = vi.fn();
const updateWeixinBindingAgentMock = vi.fn();

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => parseJsonBodyMock(...args),
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

vi.mock('@electron/message-channel/weixin/host-login', () => ({
  cancelWeChatLoginSession: vi.fn(),
  saveWeChatAccountState: vi.fn(),
  startWeChatLoginSession: vi.fn(),
  waitForWeChatLoginSession: vi.fn(),
}));

vi.mock('@electron/message-channel/weixin/binding', () => ({
  updateWeixinBindingAgent: (...args: unknown[]) => updateWeixinBindingAgentMock(...args),
  getWeixinBinding: vi.fn(),
  getBoundWeixinAccountId: vi.fn().mockReturnValue(null),
  unbindWeixinBot: vi.fn(),
}));

vi.mock('@electron/message-channel/weixin/service', () => ({
  getWeixinChannelService: vi.fn(() => ({
    setGatewayManager: vi.fn(),
    applyLoginSuccess: vi.fn(),
    ensureReady: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('handleWeixinChannelRoutes binding/agent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    parseJsonBodyMock.mockResolvedValue({});
    updateWeixinBindingAgentMock.mockResolvedValue({
      channelType: 'wechat',
      accountId: 'wx-bot',
      agentId: 'main',
      engineType: 'claude',
      enabled: true,
    });
  });

  it('updates WeChat engine and agent binding', async () => {
    parseJsonBodyMock.mockResolvedValue({
      engineType: 'claude',
      agentId: 'main',
    });

    const { handleWeixinChannelRoutes } = await import('@electron/message-channel/weixin/routes');
    const handled = await handleWeixinChannelRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/channels/wechat/binding/agent'),
      {
        gatewayManager: {},
      } as never,
    );

    expect(handled).toBe(true);
    expect(updateWeixinBindingAgentMock).toHaveBeenCalledWith({
      engineType: 'claude',
      agentId: 'main',
    });
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        success: true,
        binding: expect.objectContaining({
          engineType: 'claude',
          agentId: 'main',
        }),
      }),
    );
  });

  it('rejects missing engineType or agentId', async () => {
    parseJsonBodyMock.mockResolvedValue({ engineType: 'claude' });

    const { handleWeixinChannelRoutes } = await import('@electron/message-channel/weixin/routes');
    const handled = await handleWeixinChannelRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/channels/wechat/binding/agent'),
      {
        gatewayManager: {},
      } as never,
    );

    expect(handled).toBe(true);
    expect(updateWeixinBindingAgentMock).not.toHaveBeenCalled();
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      400,
      expect.objectContaining({ success: false }),
    );
  });
});
