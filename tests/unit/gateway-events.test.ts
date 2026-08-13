import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();
const subscribeHostEventMock = vi.fn();
const loadHistoryMock = vi.fn();
const chatStateMock = {
  currentSessionKey: 'agent:main',
  loadHistory: (...args: unknown[]) => loadHistoryMock(...args),
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
    expect(subscribeHostEventMock).not.toHaveBeenCalledWith('gateway:notification', expect.any(Function));
    expect(subscribeHostEventMock).not.toHaveBeenCalledWith('gateway:engine-event', expect.any(Function));
    expect(subscribeHostEventMock).toHaveBeenCalledWith('chat-runtime:event', expect.any(Function));
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:channel-status', expect.any(Function));

    handlers.get('gateway:status')?.({ state: 'stopped', port: 18789 });
    expect(useGatewayStore.getState().status.state).toBe('stopped');
  });

  it('leaves reconnect reconciliation to the main chat runtime supervisor', async () => {
    hostApiFetchMock.mockResolvedValueOnce({ state: 'reconnecting', port: 18789 });
    const handlers = new Map<string, (payload: unknown) => void>();
    subscribeHostEventMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();
    handlers.get('gateway:status')?.({ state: 'running', port: 18789 });

    await Promise.resolve();
    expect(loadHistoryMock).not.toHaveBeenCalled();
  });

  it('does not subscribe the renderer to legacy engine events', async () => {
    hostApiFetchMock.mockResolvedValueOnce({ state: 'running', port: 18789 });
    const handlers = new Map<string, (payload: unknown) => void>();
    subscribeHostEventMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();
    expect(handlers.has('gateway:engine-event')).toBe(false);
  });

  it('routes canonical chat events through the runtime projection', async () => {
    hostApiFetchMock.mockResolvedValueOnce({ state: 'running', port: 18789 });
    const handlers = new Map<string, (payload: unknown) => void>();
    subscribeHostEventMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });
    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();
    handlers.get('chat-runtime:event')?.({
      protocolVersion: 1,
      eventId: 'event-1',
      sessionKey: 'agent:main',
      runId: 'run-1',
      engineType: 'openclaw',
      epoch: 1,
      sequence: 1,
      occurredAt: Date.now(),
      type: 'message.delta',
      payload: { role: 'assistant', content: 'hello' },
    });
    await Promise.resolve();
    expect(handlers.has('chat-runtime:event')).toBe(true);
  });
});
