import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();
const subscribeHostEventMock = vi.fn();
const loadHistoryMock = vi.fn();
const dispatchBuiltinToolResultMock = vi.fn();
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

vi.mock('@/lib/api-client', () => ({
  invokeIpc: vi.fn(async () => []),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: {
    getState: () => chatStateMock,
  },
}));

vi.mock('@/lib/builtin-tool-dispatch', () => ({
  dispatchBuiltinToolResult: (...args: unknown[]) => dispatchBuiltinToolResultMock(...args),
}));

describe('gateway store event wiring', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    loadHistoryMock.mockResolvedValue(undefined);
    dispatchBuiltinToolResultMock.mockResolvedValue(true);
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

  it('dispatches builtin tool results without reloading history', async () => {
    hostApiFetchMock.mockResolvedValueOnce({ state: 'running', port: 18789 });
    const handlers = new Map<string, (payload: unknown) => void>();
    subscribeHostEventMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });
    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();
    const emit = handlers.get('chat-runtime:event');
    emit?.({
      protocolVersion: 1,
      eventId: 'start-1',
      sessionKey: 'agent:main',
      runId: 'run-1',
      engineType: 'openclaw',
      epoch: 1,
      sequence: 1,
      occurredAt: Date.now(),
      type: 'run.started',
      payload: {},
    });
    emit?.({
      protocolVersion: 1,
      eventId: 'tool-1',
      sessionKey: 'agent:main',
      runId: 'run-1',
      engineType: 'openclaw',
      epoch: 1,
      sequence: 2,
      occurredAt: Date.now(),
      type: 'tool.updated',
      payload: {
        id: 'tool-result-1',
        role: 'toolresult',
        toolCallId: 'call-1',
        toolName: 'sto_workflow',
        content: { success: true, type: 'workflow_created' },
      },
    });
    await vi.waitFor(() => {
      expect(dispatchBuiltinToolResultMock).toHaveBeenCalledTimes(1);
    });
    expect(loadHistoryMock).not.toHaveBeenCalled();
  });
});
