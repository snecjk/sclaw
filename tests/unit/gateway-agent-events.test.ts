import { describe, expect, it } from 'vitest';
import { shouldFinalizeCompletedRun, shouldRefreshSessionList } from '@/stores/chat/gateway-agent-events';
import { createIdleSessionRuntimeState } from '@/stores/chat/session-runtime';

describe('gateway agent event side effects', () => {
  it('refreshes sessions when the resolved session is missing or not current', () => {
    expect(shouldRefreshSessionList({
      resolvedSessionKey: 'agent:main',
      currentSessionKey: 'agent:main',
      sessions: [{ key: 'agent:main' }],
    })).toBe(false);

    expect(shouldRefreshSessionList({
      resolvedSessionKey: 'agent:other',
      currentSessionKey: 'agent:main',
      sessions: [{ key: 'agent:other' }],
    })).toBe(true);

    expect(shouldRefreshSessionList({
      resolvedSessionKey: 'agent:missing',
      currentSessionKey: 'agent:missing',
      sessions: [{ key: 'agent:main' }],
    })).toBe(true);
  });

  it('skips session refresh when completion has no session key', () => {
    expect(shouldRefreshSessionList({
      resolvedSessionKey: null,
      currentSessionKey: 'agent:main',
      sessions: [{ key: 'agent:main' }],
    })).toBe(false);
  });

  it('does not finalize a new active run from an old completion event', () => {
    const runtime = {
      ...createIdleSessionRuntimeState(),
      sending: true,
      activeRunId: 'run-new',
    };
    expect(shouldFinalizeCompletedRun({
      runId: 'run-old',
      resolvedSessionKey: 'agent:main',
      state: {
        activeRunId: 'run-new',
        currentSessionKey: 'agent:main',
        runtimeBySessionKey: { 'agent:main': runtime },
        sending: true,
      },
    })).toBe(false);
  });
});

