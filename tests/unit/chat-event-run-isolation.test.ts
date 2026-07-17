import { beforeEach, describe, expect, it } from 'vitest';
import { useChatStore } from '@/stores/chat';
import { initialChatDataState } from '@/stores/chat/initial-state';
import { createIdleSessionRuntimeState } from '@/stores/chat/session-runtime';
import { clearSessionRunLifecycle, recordTerminalRun } from '@/stores/chat/run-lifecycle';

const SESSION = 'agent:main:main';

describe('foreground chat event run isolation', () => {
  beforeEach(() => {
    clearSessionRunLifecycle(SESSION);
    useChatStore.setState({
      ...initialChatDataState,
      currentSessionKey: SESSION,
      sessions: [{ key: SESSION, engineType: 'openclaw' }],
      runtimeBySessionKey: { [SESSION]: createIdleSessionRuntimeState() },
    });
  });

  it('does not mirror or apply a late event from an old run', () => {
    useChatStore.setState((state) => ({
      ...state,
      sending: true,
      activeRunId: 'run-new',
      runtimeBySessionKey: {
        ...state.runtimeBySessionKey,
        [SESSION]: {
          ...createIdleSessionRuntimeState(),
          sending: true,
          activeRunId: 'run-new',
        },
      },
    }));

    useChatStore.getState().handleChatEvent({
      state: 'delta',
      sessionKey: SESSION,
      runId: 'run-old',
      message: { role: 'assistant', content: 'stale output' },
    });

    const runtime = useChatStore.getState().runtimeBySessionKey[SESSION];
    expect(runtime.activeRunId).toBe('run-new');
    expect(runtime.streamingMessages).toEqual([]);
  });

  it('does not resurrect a terminal run from a late started event', () => {
    recordTerminalRun(SESSION, 'run-complete');

    useChatStore.getState().handleChatEvent({
      state: 'started',
      sessionKey: SESSION,
      runId: 'run-complete',
    });

    const runtime = useChatStore.getState().runtimeBySessionKey[SESSION];
    expect(runtime.sending).toBe(false);
    expect(runtime.activeRunId).toBeNull();
  });
});
