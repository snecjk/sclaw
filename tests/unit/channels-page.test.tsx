import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Channels } from '@/pages/Channels/index';

const hostApiFetchMock = vi.fn();
const subscribeHostEventMock = vi.fn();

const { gatewayState } = vi.hoisted(() => ({
  gatewayState: {
    status: { state: 'running', port: 18789 },
  },
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/lib/host-events', () => ({
  subscribeHostEvent: (...args: unknown[]) => subscribeHostEventMock(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function mockDefaultApis(channels: unknown[] = []) {
  hostApiFetchMock.mockImplementation(async (path: string) => {
    if (path === '/api/channels/accounts') {
      return { success: true, channels };
    }
    if (path === '/api/channels/hub/dingtalk/status') {
      return { success: true, local: null, remote: null };
    }
    if (path === '/api/channels/hub/mobile/status') {
      return { success: true, local: null, ws: { connected: false } };
    }
    if (path === '/api/settings') {
      return { channelSessionIdleEnabled: true, channelSessionIdleHours: 24 };
    }
    if (path.startsWith('/api/channels/config/')) {
      return { success: true, values: {} };
    }
    throw new Error(`Unexpected host API path: ${path}`);
  });
}

describe('Channels page status refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gatewayState.status = { state: 'running', port: 18789 };
    mockDefaultApis([
      {
        channelType: 'dingtalk',
        defaultAccountId: 'default',
        status: 'connected',
        accounts: [
          {
            accountId: 'default',
            name: 'Primary Account',
            configured: true,
            status: 'connected',
            isDefault: true,
          },
        ],
      },
    ]);
  });

  it('refetches channel accounts when gateway channel-status events arrive', async () => {
    let channelStatusHandler: (() => void) | undefined;
    subscribeHostEventMock.mockImplementation((eventName: string, handler: () => void) => {
      if (eventName === 'gateway:channel-status') {
        channelStatusHandler = handler;
      }
      return vi.fn();
    });

    render(<Channels />);

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/channels/accounts');
    });
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:channel-status', expect.any(Function));

    await act(async () => {
      channelStatusHandler?.();
    });

    await waitFor(() => {
      const channelFetchCalls = hostApiFetchMock.mock.calls.filter(([path]) => path === '/api/channels/accounts');
      expect(channelFetchCalls).toHaveLength(2);
    });
  });

  it('refetches when the gateway transitions to running after mount', async () => {
    gatewayState.status = { state: 'starting', port: 18789 };

    const { rerender } = render(<Channels />);

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/channels/accounts');
    });

    gatewayState.status = { state: 'running', port: 18789 };
    await act(async () => {
      rerender(<Channels />);
    });

    await waitFor(() => {
      const channelFetchCalls = hostApiFetchMock.mock.calls.filter(([path]) => path === '/api/channels/accounts');
      expect(channelFetchCalls).toHaveLength(2);
    });
  });

  it('shows unbind for bound WeChat and no engine selects', async () => {
    subscribeHostEventMock.mockImplementation(() => vi.fn());
    mockDefaultApis([
      {
        channelType: 'wechat',
        defaultAccountId: 'wx-bot-im-bot',
        status: 'connected',
        accounts: [
          {
            accountId: 'wx-bot-im-bot',
            name: 'WeChat ClawBot',
            configured: true,
            status: 'connected',
            isDefault: true,
            agentId: 'main',
            engineType: 'pi',
          },
        ],
      },
    ]);
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/channels/accounts') {
        return {
          success: true,
          channels: [
            {
              channelType: 'wechat',
              defaultAccountId: 'wx-bot-im-bot',
              status: 'connected',
              accounts: [
                {
                  accountId: 'wx-bot-im-bot',
                  name: 'WeChat ClawBot',
                  configured: true,
                  status: 'connected',
                  isDefault: true,
                  agentId: 'main',
                  engineType: 'pi',
                },
              ],
            },
          ],
        };
      }
      if (path === '/api/channels/hub/dingtalk/status') {
        return { success: true, local: null, remote: null };
      }
      if (path === '/api/channels/hub/mobile/status') {
        return { success: true, local: null, ws: { connected: false } };
      }
      if (path === '/api/settings') {
        return { channelSessionIdleEnabled: true, channelSessionIdleHours: 24 };
      }
      throw new Error(`Unexpected host API path: ${path}`);
    });

    render(<Channels />);

    await waitFor(() => {
      expect(screen.getByText('微信')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'account.unbind' })).toBeInTheDocument();
    expect(screen.queryByLabelText('hub.wechat.engineLabel')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'account.edit' })).not.toBeInTheDocument();
  });

  it('shows scan bind for available WeChat row', async () => {
    subscribeHostEventMock.mockImplementation(() => vi.fn());
    mockDefaultApis([]);

    render(<Channels />);

    await waitFor(() => {
      expect(screen.getByText('微信')).toBeInTheDocument();
    });

    const scanButtons = screen.getAllByRole('button', { name: 'account.scanBind' });
    expect(scanButtons.length).toBeGreaterThanOrEqual(1);

    fireEvent.click(scanButtons.find((btn) => btn.closest('section')?.textContent?.includes('微信'))
      ?? scanButtons[scanButtons.length - 1]);

    await waitFor(() => {
      expect(screen.getByText('dialog.configureTitle')).toBeInTheDocument();
    });
  });

  it('does not show mobile unbound hint from DingTalk remote.bound=false', async () => {
    subscribeHostEventMock.mockImplementation(() => vi.fn());
    localStorage.setItem('sclaw.mobile.configured', '1');
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/channels/accounts') {
        return { success: true, channels: [] };
      }
      if (path === '/api/channels/hub/dingtalk/status') {
        return {
          success: true,
          local: { bindStatus: 'revoked' },
          remote: { bound: false },
          deviceId: 'device-1',
        };
      }
      if (path === '/api/channels/hub/mobile/status') {
        return {
          success: true,
          local: {
            bindStatus: 'bound',
            enabled: true,
            extras: null,
          },
          ws: { connected: true },
          canConnectWs: true,
        };
      }
      if (path === '/api/settings') {
        return { channelSessionIdleEnabled: true, channelSessionIdleHours: 24 };
      }
      throw new Error(`Unexpected host API path: ${path}`);
    });

    render(<Channels />);

    await waitFor(() => {
      expect(screen.getByText('hub.mobile.title')).toBeInTheDocument();
    });
    expect(screen.getByText('hub.mobile.cardDesc')).toBeInTheDocument();
    expect(screen.queryByText('hub.mobile.replacedUnbound')).not.toBeInTheDocument();
    expect(screen.getByLabelText('hub.mobile.toggleLabel')).toBeInTheDocument();
  });

  it('shows configure after steal using extras.replaceReason, not localStorage', async () => {
    subscribeHostEventMock.mockImplementation(() => vi.fn());
    localStorage.removeItem('sclaw.mobile.configured');
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/channels/accounts') {
        return { success: true, channels: [] };
      }
      if (path === '/api/channels/hub/dingtalk/status') {
        return { success: true, local: null, remote: null };
      }
      if (path === '/api/channels/hub/mobile/status') {
        return {
          success: true,
          local: {
            bindStatus: 'revoked',
            enabled: false,
            extras: { replaceReason: 'other_device' },
          },
          ws: { connected: false },
          canConnectWs: false,
        };
      }
      if (path === '/api/settings') {
        return { channelSessionIdleEnabled: true, channelSessionIdleHours: 24 };
      }
      throw new Error(`Unexpected host API path: ${path}`);
    });

    render(<Channels />);

    await waitFor(() => {
      expect(screen.getByText('hub.mobile.replacedByOtherDevice')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'hub.mobile.configure' })).toBeInTheDocument();
  });

  it('shows bind when revoked without replaceReason even if localStorage is stale', async () => {
    subscribeHostEventMock.mockImplementation(() => vi.fn());
    localStorage.setItem('sclaw.mobile.configured', '1');
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/channels/accounts') {
        return { success: true, channels: [] };
      }
      if (path === '/api/channels/hub/dingtalk/status') {
        return { success: true, local: null, remote: null };
      }
      if (path === '/api/channels/hub/mobile/status') {
        return {
          success: true,
          local: {
            bindStatus: 'revoked',
            enabled: false,
            extras: null,
          },
          ws: { connected: false },
          canConnectWs: false,
        };
      }
      if (path === '/api/settings') {
        return { channelSessionIdleEnabled: true, channelSessionIdleHours: 24 };
      }
      throw new Error(`Unexpected host API path: ${path}`);
    });

    render(<Channels />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'account.bind' })).toBeInTheDocument();
    });
    expect(localStorage.getItem('sclaw.mobile.configured')).toBe('1');
  });

  it('keeps newer fetch result when an older request finishes later', async () => {
    let channelStatusHandler: (() => void) | undefined;
    subscribeHostEventMock.mockImplementation((eventName: string, handler: () => void) => {
      if (eventName === 'gateway:channel-status') {
        channelStatusHandler = handler;
      }
      return vi.fn();
    });

    let resolveFirstMobile: ((value: unknown) => void) | undefined;
    let mobileCalls = 0;

    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/channels/accounts') {
        return { success: true, channels: [] };
      }
      if (path === '/api/channels/hub/dingtalk/status') {
        return { success: true, local: null, remote: null };
      }
      if (path === '/api/channels/hub/mobile/status') {
        mobileCalls += 1;
        if (mobileCalls === 1) {
          return await new Promise((resolve) => {
            resolveFirstMobile = resolve;
          });
        }
        return {
          success: true,
          local: {
            bindStatus: 'revoked',
            enabled: false,
            extras: { replaceReason: 'unbound' },
          },
          ws: { connected: false },
          canConnectWs: false,
        };
      }
      if (path === '/api/settings') {
        return { channelSessionIdleEnabled: true, channelSessionIdleHours: 24 };
      }
      throw new Error(`Unexpected host API path: ${path}`);
    });

    render(<Channels />);

    await waitFor(() => {
      expect(mobileCalls).toBe(1);
      expect(channelStatusHandler).toBeTypeOf('function');
    });

    await act(async () => {
      channelStatusHandler?.();
    });

    await waitFor(() => {
      expect(screen.getByText('hub.mobile.replacedUnbound')).toBeInTheDocument();
    });

    await act(async () => {
      resolveFirstMobile?.({
        success: true,
        local: {
          bindStatus: 'bound',
          enabled: true,
          extras: null,
        },
        ws: { connected: true },
        canConnectWs: true,
      });
    });

    await waitFor(() => {
      expect(screen.getByText('hub.mobile.replacedUnbound')).toBeInTheDocument();
    });
    expect(screen.queryByLabelText('hub.mobile.toggleLabel')).not.toBeInTheDocument();
  });
});
