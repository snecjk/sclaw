import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invokeIpc = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-client', () => ({ invokeIpc }));
vi.mock('@/lib/host-events', () => ({ subscribeHostEvent: vi.fn(() => () => undefined) }));

import { useChatRuntimeV2Store } from '@/stores/chat/runtime-v2-store';

describe('chat runtime hydrate recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invokeIpc.mockReset();
    useChatRuntimeV2Store.setState({ sessionsByKey: {}, initialized: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries a failed hydrate and returns the session to ready', async () => {
    invokeIpc
      .mockRejectedValueOnce(new Error('main unavailable'))
      .mockResolvedValueOnce({
        protocolVersion: 1,
        sessionKey: 'session-retry',
        runId: 'run-1',
        idempotencyKey: 'message-1',
        runtimePolicy: { origin: 'interactive', deadlineAt: null },
        engineType: 'openclaw',
        phase: 'running',
        epoch: 1,
        sequence: 2,
        startedAt: 1,
        lastEventAt: 2,
        terminalAt: null,
        error: null,
        acceptanceResult: null,
        updatedAt: 2,
      });

    await useChatRuntimeV2Store.getState().hydrate('session-retry');
    expect(useChatRuntimeV2Store.getState().sessionsByKey['session-retry'].sync).toMatchObject({
      status: 'gapped', retryCount: 1,
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(invokeIpc).toHaveBeenCalledTimes(2);
    expect(useChatRuntimeV2Store.getState().sessionsByKey['session-retry']).toMatchObject({
      runtime: { phase: 'running', sequence: 2 },
      sync: { status: 'ready', retryCount: 0, retryAt: null },
    });
  });

  it('cancels a scheduled retry when the session is deleted', async () => {
    invokeIpc.mockRejectedValue(new Error('main unavailable'));
    await useChatRuntimeV2Store.getState().hydrate('session-delete');
    useChatRuntimeV2Store.getState().clearSession('session-delete');
    await vi.advanceTimersByTimeAsync(8_000);
    expect(invokeIpc).toHaveBeenCalledTimes(1);
  });
});
