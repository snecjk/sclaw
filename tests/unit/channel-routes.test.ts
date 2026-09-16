import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const listConfiguredChannelsMock = vi.fn();
const listConfiguredChannelAccountsMock = vi.fn();
const readOpenClawConfigMock = vi.fn();
const listAgentsSnapshotMock = vi.fn();
const assignChannelAccountToAgentMock = vi.fn();
const parseJsonBodyMock = vi.fn();
const sendJsonMock = vi.fn();

vi.mock('@electron/utils/channel-config', () => ({
  cleanupDanglingWeChatPluginState: vi.fn(),
  deleteChannelAccountConfig: vi.fn(),
  deleteChannelConfig: vi.fn(),
  getChannelFormValues: vi.fn(),
  listConfiguredChannelAccounts: (...args: unknown[]) => listConfiguredChannelAccountsMock(...args),
  listConfiguredChannels: (...args: unknown[]) => listConfiguredChannelsMock(...args),
  readOpenClawConfig: (...args: unknown[]) => readOpenClawConfigMock(...args),
  saveChannelConfig: vi.fn(),
  setChannelDefaultAccount: vi.fn(),
  setChannelEnabled: vi.fn(),
  validateChannelConfig: vi.fn(),
  validateChannelCredentials: vi.fn(),
}));

vi.mock('@electron/utils/agent-config', () => ({
  assignChannelAccountToAgent: (...args: unknown[]) => assignChannelAccountToAgentMock(...args),
  clearAllBindingsForChannel: vi.fn(),
  clearChannelBinding: vi.fn(),
  listAgentsSnapshot: (...args: unknown[]) => listAgentsSnapshotMock(...args),
}));

vi.mock('@electron/utils/wechat-login', () => ({
  cancelWeChatLoginSession: vi.fn(),
  saveWeChatAccountState: vi.fn(),
  startWeChatLoginSession: vi.fn(),
  waitForWeChatLoginSession: vi.fn(),
}));

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => parseJsonBodyMock(...args),
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

describe('handleChannelRoutes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    assignChannelAccountToAgentMock.mockResolvedValue(undefined);
    parseJsonBodyMock.mockResolvedValue({});
    listAgentsSnapshotMock.mockResolvedValue({
      agents: [],
      channelAccountOwners: {},
    });
    readOpenClawConfigMock.mockResolvedValue({
      channels: {},
    });
  });

  it('reports healthy running multi-account channels as connected', async () => {
    listConfiguredChannelsMock.mockResolvedValue(['dingtalk']);
    listConfiguredChannelAccountsMock.mockResolvedValue({
      dingtalk: {
        defaultAccountId: 'default',
        accountIds: ['default', 'dingtalk-2412524e'],
      },
    });
    readOpenClawConfigMock.mockResolvedValue({
      channels: {
        dingtalk: {
          defaultAccount: 'default',
        },
      },
    });
    listAgentsSnapshotMock.mockResolvedValue({
      agents: [],
      channelAccountOwners: {
        'dingtalk:default': 'main',
        'dingtalk:dingtalk-2412524e': 'code',
      },
    });

    const rpc = vi.fn().mockResolvedValue({
      channels: {
        dingtalk: {
          configured: true,
        },
      },
      channelAccounts: {
        dingtalk: [
          {
            accountId: 'default',
            configured: true,
            connected: false,
            running: true,
            linked: false,
          },
          {
            accountId: 'dingtalk-2412524e',
            configured: true,
            connected: false,
            running: true,
            linked: false,
          },
        ],
      },
      channelDefaultAccountId: {
        dingtalk: 'default',
      },
    });

    const { handleChannelRoutes } = await import('@electron/api/routes/channels');
    const handled = await handleChannelRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/channels/accounts'),
      {
        gatewayManager: {
          rpc,
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
          debouncedRestart: vi.fn(),
        },
      } as never,
    );

    expect(handled).toBe(true);
    expect(rpc).toHaveBeenCalledWith('channels.status', { probe: true });
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        success: true,
        channels: [
          expect.objectContaining({
            channelType: 'dingtalk',
            status: 'connected',
            accounts: expect.arrayContaining([
              expect.objectContaining({ accountId: 'default', status: 'connected' }),
              expect.objectContaining({ accountId: 'dingtalk-2412524e', status: 'connected' }),
            ]),
          }),
        ],
      }),
    );
  });

  it('keeps channel connected when one account is healthy and another errors', async () => {
    listConfiguredChannelsMock.mockResolvedValue(['dingtalk']);
    listConfiguredChannelAccountsMock.mockResolvedValue({
      dingtalk: {
        defaultAccountId: 'default',
        accountIds: ['default', 'dingtalk-b'],
      },
    });
    readOpenClawConfigMock.mockResolvedValue({
      channels: {
        dingtalk: {
          defaultAccount: 'default',
        },
      },
    });

    const rpc = vi.fn().mockResolvedValue({
      channels: {
        dingtalk: {
          configured: true,
        },
      },
      channelAccounts: {
        dingtalk: [
          {
            accountId: 'default',
            configured: true,
            connected: true,
            running: true,
            linked: false,
          },
          {
            accountId: 'dingtalk-b',
            configured: true,
            connected: false,
            running: false,
            linked: false,
            lastError: 'secondary bot failed',
          },
        ],
      },
      channelDefaultAccountId: {
        dingtalk: 'default',
      },
    });

    const { handleChannelRoutes } = await import('@electron/api/routes/channels');
    await handleChannelRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/channels/accounts'),
      {
        gatewayManager: {
          rpc,
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
          debouncedRestart: vi.fn(),
        },
      } as never,
    );

    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        success: true,
        channels: [
          expect.objectContaining({
            channelType: 'dingtalk',
            status: 'connected',
            accounts: expect.arrayContaining([
              expect.objectContaining({ accountId: 'default', status: 'connected' }),
              expect.objectContaining({ accountId: 'dingtalk-b', status: 'error' }),
            ]),
          }),
        ],
      }),
    );
  });

  it('reloads gateway when binding a Host-Worker WeChat account (no plugin restart)', async () => {
    parseJsonBodyMock.mockResolvedValue({
      channelType: 'wechat',
      accountId: 'bot-im-bot',
      agentId: 'main',
    });

    const debouncedReload = vi.fn();
    const debouncedRestart = vi.fn();

    const { handleChannelRoutes } = await import('@electron/api/routes/channels');
    const handled = await handleChannelRoutes(
      { method: 'PUT' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/channels/binding'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running' }),
          debouncedReload,
          debouncedRestart,
        },
      } as never,
    );

    expect(handled).toBe(true);
    expect(assignChannelAccountToAgentMock).toHaveBeenCalledWith(
      'main',
      'openclaw-weixin',
      'bot-im-bot',
    );
    expect(debouncedReload).toHaveBeenCalled();
    expect(debouncedRestart).not.toHaveBeenCalled();
  });

  it('does not auto-bind WeChat accounts when listing channel accounts', async () => {
    listConfiguredChannelsMock.mockResolvedValue(['openclaw-weixin']);
    listConfiguredChannelAccountsMock.mockResolvedValue({
      'openclaw-weixin': {
        defaultAccountId: 'bot-im-bot',
        accountIds: ['bot-im-bot'],
      },
    });
    readOpenClawConfigMock.mockResolvedValue({
      channels: {
        'openclaw-weixin': {
          defaultAccount: 'bot-im-bot',
          accounts: {
            'bot-im-bot': { enabled: true },
          },
        },
      },
    });
    listAgentsSnapshotMock.mockResolvedValue({
      agents: [{ id: 'main', name: 'Main' }],
      channelAccountOwners: {},
    });

    const rpc = vi.fn().mockResolvedValue({
      channelAccounts: {
        'openclaw-weixin': [
          {
            accountId: 'bot-im-bot',
            configured: true,
            running: false,
          },
        ],
      },
    });

    const { handleChannelRoutes } = await import('@electron/api/routes/channels');
    await handleChannelRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/channels/accounts'),
      {
        gatewayManager: {
          rpc,
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
          debouncedRestart: vi.fn(),
        },
      } as never,
    );

    expect(assignChannelAccountToAgentMock).not.toHaveBeenCalled();
    const payload = sendJsonMock.mock.calls.at(-1)?.[2] as {
      channels?: Array<{ accounts?: Array<{ accountId?: string; agentId?: string }> }>;
    };
    expect(payload.channels?.[0]?.accounts?.[0]).toMatchObject({
      accountId: 'bot-im-bot',
    });
    expect(payload.channels?.[0]?.accounts?.[0]?.agentId).toBeUndefined();
  });

  it('reloads gateway in-place when binding a non-plugin channel account', async () => {
    parseJsonBodyMock.mockResolvedValue({
      channelType: 'dingtalk',
      accountId: 'default',
      agentId: 'main',
    });

    const debouncedReload = vi.fn();
    const debouncedRestart = vi.fn();

    const { handleChannelRoutes } = await import('@electron/api/routes/channels');
    const handled = await handleChannelRoutes(
      { method: 'PUT' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/channels/binding'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running' }),
          debouncedReload,
          debouncedRestart,
        },
      } as never,
    );

    expect(handled).toBe(true);
    expect(debouncedReload).toHaveBeenCalled();
    expect(debouncedRestart).not.toHaveBeenCalled();
  });
});
