import { beforeEach, describe, expect, it } from 'vitest';
import { useChatRuntimeV2Store } from '@/stores/chat/runtime-v2-store';
import { createClientSessionState } from '@/stores/chat/client-session-reducer';

const SESSION_KEY = 'agent:main:trim-tail';

describe('trimSessionHistoryTail', () => {
  beforeEach(() => {
    useChatRuntimeV2Store.getState().clearSession(SESSION_KEY);
  });

  it('keeps the newest 50 messages and records historyTotalCount', () => {
    const transcript = Array.from({ length: 80 }, (_, index) => ({
      id: `m${index}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: String(index),
      timestamp: index,
    })) as ReturnType<typeof createClientSessionState>['transcript'];
    useChatRuntimeV2Store.setState((state) => ({
      sessionsByKey: {
        ...state.sessionsByKey,
        [SESSION_KEY]: {
          ...createClientSessionState(),
          transcript,
          historyTotalCount: 0,
          historyCapabilities: { paginationMode: 'before-id', defaultPageSize: 50 },
        },
      },
    }));
    useChatRuntimeV2Store.getState().trimSessionHistoryTail(SESSION_KEY);
    const session = useChatRuntimeV2Store.getState().sessionsByKey[SESSION_KEY];
    expect(session?.transcript).toHaveLength(50);
    expect(session?.transcript[0]?.id).toBe('m30');
    expect(session?.historyTotalCount).toBe(80);
  });

  it('does not trim while a run is still active', () => {
    useChatRuntimeV2Store.setState((state) => ({
      sessionsByKey: {
        ...state.sessionsByKey,
        [SESSION_KEY]: {
          ...createClientSessionState(),
          transcript: Array.from({ length: 60 }, (_, index) => ({
            id: `m${index}`,
            role: 'user',
            content: String(index),
          })),
          historyCapabilities: { paginationMode: 'before-id', defaultPageSize: 50 },
          runtime: {
            phase: 'running',
            runId: 'run-1',
            idempotencyKey: null,
            engineType: 'claude',
            epoch: 1,
            sequence: 1,
            startedAt: 1,
            lastEventAt: 1,
          },
        },
      },
    }));
    useChatRuntimeV2Store.getState().trimSessionHistoryTail(SESSION_KEY);
    expect(useChatRuntimeV2Store.getState().sessionsByKey[SESSION_KEY]?.transcript).toHaveLength(60);
  });

  it('does not trim an engine that cannot load older pages', () => {
    const transcript = Array.from({ length: 80 }, (_, index) => ({
      id: `m${index}`,
      role: 'assistant',
      content: String(index),
    })) as ReturnType<typeof createClientSessionState>['transcript'];
    useChatRuntimeV2Store.setState((state) => ({
      sessionsByKey: {
        ...state.sessionsByKey,
        [SESSION_KEY]: {
          ...createClientSessionState(),
          transcript,
          historyCapabilities: { paginationMode: 'none', defaultPageSize: 1000 },
        },
      },
    }));

    useChatRuntimeV2Store.getState().trimSessionHistoryTail(SESSION_KEY);
    expect(useChatRuntimeV2Store.getState().sessionsByKey[SESSION_KEY]?.transcript).toHaveLength(80);
  });
});
