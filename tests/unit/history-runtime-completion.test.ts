import { describe, expect, it, vi } from 'vitest';
import {
  reconcileHistoryRuntimeCompletion,
  shouldAutoCompleteOpenClawFromHistory,
} from '@/stores/chat/history-runtime-completion';
import { initialChatDataState } from '@/stores/chat/initial-state';
import { createIdleSessionRuntimeState } from '@/stores/chat/session-runtime';
import type { ChatSet } from '@/stores/chat/store-api';
import type { ChatState } from '@/stores/chat/types';

const readySnapshot = {
  isSending: true,
  pendingFinal: true,
  hasRecentAssistantOutput: true,
  hasRunningTool: false,
};

describe('OpenClaw history runtime completion', () => {
  it('keeps the run active when history omits authoritative runtime state', () => {
    expect(shouldAutoCompleteOpenClawFromHistory(readySnapshot)).toBe(false);
    expect(shouldAutoCompleteOpenClawFromHistory({
      ...readySnapshot,
      runtimeState: { isRunning: undefined },
    })).toBe(false);
  });

  it('keeps the run active while history reports it is still running', () => {
    expect(shouldAutoCompleteOpenClawFromHistory({
      ...readySnapshot,
      runtimeState: { isRunning: true },
    })).toBe(false);
  });

  it('completes only after history explicitly reports the run stopped', () => {
    expect(shouldAutoCompleteOpenClawFromHistory({
      ...readySnapshot,
      runtimeState: { isRunning: false },
    })).toBe(true);
  });

  it('does not complete while a streamed tool is still running', () => {
    expect(shouldAutoCompleteOpenClawFromHistory({
      ...readySnapshot,
      hasRunningTool: true,
      runtimeState: { isRunning: false },
    })).toBe(false);
  });

  it('preserves activeRunId when an intermediate history snapshot has no runtime state', () => {
    const sessionKey = 'agent:main:history-runtime';
    let state = {
      ...initialChatDataState,
      currentSessionKey: sessionKey,
      currentAgentId: 'main',
      sessions: [{ key: sessionKey, engineType: 'openclaw' }],
      sending: true,
      pendingFinal: true,
      activeRunId: 'run-active',
      messages: [],
      runtimeBySessionKey: {
        [sessionKey]: {
          ...createIdleSessionRuntimeState(),
          sending: true,
          pendingFinal: true,
          activeRunId: 'run-active',
        },
      },
    } as unknown as ChatState;
    const get = () => state;
    const set: ChatSet = (partial) => {
      state = { ...state, ...(typeof partial === 'function' ? partial(state) : partial) };
    };
    const clearHistoryPoll = vi.fn();

    reconcileHistoryRuntimeCompletion({
      get,
      set,
      sessionKey,
      filteredMessages: [{ role: 'assistant', content: '阶段性说明' }],
      runtimeState: { isRunning: undefined },
      activeEngineType: 'openclaw',
      toMs: (value) => Number(value),
      clearHistoryPoll,
    });

    expect(state.runtimeBySessionKey[sessionKey]).toMatchObject({
      sending: true,
      pendingFinal: true,
      activeRunId: 'run-active',
    });
    expect(clearHistoryPoll).not.toHaveBeenCalled();
  });
});
