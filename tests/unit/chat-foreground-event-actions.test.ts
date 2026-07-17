import { afterEach, describe, expect, it, vi } from 'vitest';
import { createForegroundEventActions } from '@/stores/chat/foreground-event-actions';
import { initialChatDataState } from '@/stores/chat/initial-state';
import { createIdleSessionRuntimeState } from '@/stores/chat/session-runtime';
import type { ChatState } from '@/stores/chat/types';
import type { ChatSet } from '@/stores/chat/store-api';

const SESSION = 'agent:main:foreground';

function createHarness() {
  let state = {
    ...initialChatDataState,
    currentSessionKey: SESSION,
    currentAgentId: 'main',
    sessions: [{ key: SESSION, engineType: 'openclaw' }],
    runtimeBySessionKey: {
      [SESSION]: {
        ...createIdleSessionRuntimeState(),
        sending: true,
        activeRunId: 'run-active',
      },
      'agent:writer:background': {
        ...createIdleSessionRuntimeState(),
        sending: true,
        activeRunId: 'run-background',
      },
    },
    loadHistory: vi.fn().mockResolvedValue(undefined),
  } as unknown as ChatState;
  const get = () => state;
  const set: ChatSet = (partial) => {
    state = { ...state, ...(typeof partial === 'function' ? partial(state) : partial) };
  };
  const handleBackgroundSessionEvent = vi.fn();
  const setErrorRecoveryTimer = vi.fn();
  const actions = createForegroundEventActions(set, get, {
    resolveEngineTypeForSession: () => 'openclaw',
    handleBackgroundSessionEvent,
    dispatchAgentMemoryCapture: vi.fn(),
    clearHistoryPoll: vi.fn(),
    clearErrorRecoveryTimer: vi.fn(),
    setErrorRecoveryTimer,
    hasErrorRecoveryTimer: vi.fn(() => false),
  });
  return { actions, get, handleBackgroundSessionEvent, setErrorRecoveryTimer };
}

describe('foreground event routing', () => {
  afterEach(() => vi.useRealTimers());

  it('does not mirror an active error through the background reducer', () => {
    vi.useFakeTimers();
    const { actions, get, handleBackgroundSessionEvent, setErrorRecoveryTimer } = createHarness();

    actions.handleChatEvent({
      state: 'error',
      sessionKey: SESSION,
      runId: 'run-active',
      errorMessage: 'temporary transport error',
      seq: crypto.randomUUID(),
    });

    expect(handleBackgroundSessionEvent).not.toHaveBeenCalled();
    expect(get().runtimeBySessionKey[SESSION]).toMatchObject({
      sending: true,
      activeRunId: 'run-active',
      error: 'temporary transport error',
    });
    expect(setErrorRecoveryTimer).toHaveBeenCalledTimes(1);
  });

  it('deduplicates a background event before invoking its reducer', () => {
    const { actions, handleBackgroundSessionEvent } = createHarness();
    const event = {
      state: 'delta',
      sessionKey: 'agent:writer:background',
      runId: 'run-background',
      seq: crypto.randomUUID(),
      message: { role: 'assistant', content: 'partial' },
    };

    actions.handleChatEvent(event);
    actions.handleChatEvent(event);

    expect(handleBackgroundSessionEvent).toHaveBeenCalledTimes(1);
  });

  it('does not collapse distinct equal-length background deltas', () => {
    const { actions, handleBackgroundSessionEvent } = createHarness();
    const base = {
      state: 'delta',
      sessionKey: 'agent:writer:background',
      runId: 'run-background',
    };

    actions.handleChatEvent({ ...base, message: { role: 'assistant', content: 'first' } });
    actions.handleChatEvent({ ...base, message: { role: 'assistant', content: 'other' } });

    expect(handleBackgroundSessionEvent).toHaveBeenCalledTimes(2);
  });
});
