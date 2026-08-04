import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  completeRunAfterAgentCompleted,
  scheduleCompletedRunHistoryReload,
  shouldFinalizeCompletedRun,
  shouldIgnoreGatewayAgentSession,
  shouldRefreshSessionList,
} from '@/stores/chat/gateway-agent-events';
import { createIdleSessionRuntimeState } from '@/stores/chat/session-runtime';

const storeHarness = vi.hoisted(() => ({
  state: null as unknown as Record<string, unknown>,
  finalizeRun: vi.fn(),
}));

vi.mock('@/stores/chat/store', () => ({
  useChatStore: {
    getState: () => storeHarness.state,
  },
  finalizeOpenClawRunAfterAgentCompleted: (...args: unknown[]) => storeHarness.finalizeRun(...args),
}));

const SESSION = 'agent:main';

describe('gateway agent event side effects', () => {
  beforeEach(() => {
    storeHarness.finalizeRun.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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

  it('ignores workflow smart-node sessions in the ordinary chat event pipeline', () => {
    expect(shouldIgnoreGatewayAgentSession('agent:workflow-runtime:workflow:run-1:node-1')).toBe(true);
    expect(shouldIgnoreGatewayAgentSession('agent:main:session-1')).toBe(false);
    expect(shouldIgnoreGatewayAgentSession(null)).toBe(false);
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

  it('finalizes completed run when sending with pendingFinal but no activeRunId', () => {
    const runtime = {
      ...createIdleSessionRuntimeState(),
      sending: true,
      pendingFinal: true,
      activeRunId: null,
      sendAcceptance: null,
    };
    expect(shouldFinalizeCompletedRun({
      runId: 'run-1',
      resolvedSessionKey: 'agent:main',
      state: {
        activeRunId: null,
        currentSessionKey: 'agent:main',
        runtimeBySessionKey: { 'agent:main': runtime },
        sending: true,
      },
    })).toBe(true);
  });

  it('finalizes a completed run without waiting for history', async () => {
    const loadHistory = vi.fn(() => new Promise<void>(() => {}));
    const runtime = {
      ...createIdleSessionRuntimeState(),
      sending: true,
      activeRunId: 'run-completed-immediately',
    };
    storeHarness.state = {
      activeRunId: runtime.activeRunId,
      currentSessionKey: SESSION,
      runtimeBySessionKey: { [SESSION]: runtime },
      sending: true,
      loadHistory,
    };

    await completeRunAfterAgentCompleted(runtime.activeRunId, SESSION);

    expect(storeHarness.finalizeRun).toHaveBeenCalledWith(SESSION, runtime.activeRunId);
    expect(loadHistory).not.toHaveBeenCalled();
  });

  it('retries completed-run history sync after sending is already false', async () => {
    vi.useFakeTimers();
    const loadHistory = vi.fn().mockResolvedValue(undefined);
    storeHarness.state = {
      currentSessionKey: SESSION,
      runtimeBySessionKey: {
        [SESSION]: {
          ...createIdleSessionRuntimeState(),
          sending: false,
        },
      },
      sending: false,
      loadHistory,
    };

    scheduleCompletedRunHistoryReload('run-history-retry', SESSION);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(loadHistory).toHaveBeenCalledTimes(4);
    expect(loadHistory).toHaveBeenNthCalledWith(1, true, true, SESSION);
    expect(loadHistory).toHaveBeenNthCalledWith(4, true, true, SESSION);
  });
});

