import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();
const subscribeHostEventMock = vi.fn();
const loadHistoryMock = vi.fn();
const handleChatEventMock = vi.fn();
const chatStateMock = {
  currentSessionKey: 'agent:main',
  runtimeBySessionKey: {
    'agent:main': {
      sending: true,
      pendingFinal: false,
      activeRunId: 'run-reconnect',
    },
    'agent:idle': {
      sending: false,
      pendingFinal: false,
      activeRunId: null,
    },
  },
  loadHistory: (...args: unknown[]) => loadHistoryMock(...args),
  handleChatEvent: (...args: unknown[]) => handleChatEventMock(...args),
};

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/lib/host-events', () => ({
  subscribeHostEvent: (...args: unknown[]) => subscribeHostEventMock(...args),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: {
    getState: () => chatStateMock,
  },
}));

describe('gateway store event wiring', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    loadHistoryMock.mockResolvedValue(undefined);
  });

  it('subscribes to host events through subscribeHostEvent on init', async () => {
    hostApiFetchMock.mockResolvedValueOnce({ state: 'running', port: 18789 });

    const handlers = new Map<string, (payload: unknown) => void>();
    subscribeHostEventMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();

    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:status', expect.any(Function));
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:error', expect.any(Function));
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:notification', expect.any(Function));
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:engine-event', expect.any(Function));
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:channel-status', expect.any(Function));

    handlers.get('gateway:status')?.({ state: 'stopped', port: 18789 });
    expect(useGatewayStore.getState().status.state).toBe('stopped');
  });

  it('reconciles active chat runs when gateway reconnects', async () => {
    hostApiFetchMock.mockResolvedValueOnce({ state: 'reconnecting', port: 18789 });
    const handlers = new Map<string, (payload: unknown) => void>();
    subscribeHostEventMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();
    handlers.get('gateway:status')?.({ state: 'running', port: 18789 });

    await vi.waitFor(() => {
      expect(loadHistoryMock).toHaveBeenCalledWith(true, true, 'agent:main');
    });
    expect(loadHistoryMock).not.toHaveBeenCalledWith(true, true, 'agent:idle');
  });

  it('does not route workflow smart-node engine events into the chat store', async () => {
    hostApiFetchMock.mockResolvedValueOnce({ state: 'running', port: 18789 });
    const handlers = new Map<string, (payload: unknown) => void>();
    subscribeHostEventMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();
    handlers.get('gateway:engine-event')?.({
      type: 'message.delta',
      sessionKey: 'agent:workflow-runtime:workflow:run-1:node-1',
      runId: 'gateway-run-1',
      message: { role: 'assistant', content: [{ type: 'text', text: 'working' }] },
    });

    await Promise.resolve();
    expect(handleChatEventMock).not.toHaveBeenCalled();
  });
});
