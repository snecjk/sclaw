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
});
