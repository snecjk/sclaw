import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleSendWatchdogs } from '@/stores/chat/send-watchdogs';
import { createIdleSessionRuntimeState } from '@/stores/chat/session-runtime';
import type { ChatState } from '@/stores/chat/types';
import type { ChatSet } from '@/stores/chat/store-api';

const SESSION = 'agent:main:watchdog';

function createHarness(runtimePatch: Record<string, unknown>) {
  const loadHistory = vi.fn().mockResolvedValue(undefined);
  let state = {
    runtimeBySessionKey: {
      [SESSION]: {
        ...createIdleSessionRuntimeState(),
        sending: true,
        activeRunId: 'run-watchdog',
        sendAcceptance: {
          idempotencyKey: 'send-watchdog',
          status: 'accepted' as const,
          startedAt: Date.now(),
        },
        ...runtimePatch,
      },
    },
    loadHistory,
  } as unknown as ChatState;
  const set: ChatSet = (partial) => {
    state = { ...state, ...(typeof partial === 'function' ? partial(state) : partial) };
  };

  scheduleSendWatchdogs({
    get: () => state,
    set,
    sessionKey: SESSION,
    clearErrorRecoveryTimer: vi.fn(),
    clearHistoryPoll: vi.fn(),
    setHistoryPollTimer: vi.fn(),
    clearStuckCheckTimer: vi.fn(),
    setStuckCheckTimer: vi.fn(),
  });

  return { get: () => state, loadHistory };
}

describe('chat send watchdogs', () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('forces history reconciliation after silence even with stale streaming content', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const { loadHistory } = createHarness({
      streamingMessage: { role: 'assistant', content: 'partial' },
      updatedAt: 1_000,
    });

    await vi.advanceTimersByTimeAsync(3_000);

    expect(loadHistory).toHaveBeenCalledWith(true, true, SESSION);
  });

  it('reconciles pendingFinal through history without fabricating a terminal state', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const { get, loadHistory } = createHarness({
      pendingFinal: true,
      streamingMessage: null,
      streamingText: '',
      streamingTools: [],
      updatedAt: 1_000,
    });

    await vi.advanceTimersByTimeAsync(8_000);

    expect(loadHistory).toHaveBeenCalledWith(true, true, SESSION);
    expect(get().runtimeBySessionKey[SESSION].sending).toBe(true);
    expect(get().runtimeBySessionKey[SESSION].pendingFinal).toBe(true);
  });
});
