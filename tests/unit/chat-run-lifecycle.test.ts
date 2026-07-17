import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSessionRunLifecycle,
  decideRunEvent,
  recordTerminalRun,
} from '@/stores/chat/run-lifecycle';
import { createIdleSessionRuntimeState } from '@/stores/chat/session-runtime';

const SESSION = 'agent:main:main';

describe('chat run lifecycle isolation', () => {
  beforeEach(() => clearSessionRunLifecycle(SESSION));

  it('rejects events from a different run before state mutation', () => {
    const runtime = {
      ...createIdleSessionRuntimeState(),
      sending: true,
      activeRunId: 'run-current',
    };

    expect(decideRunEvent({
      sessionKey: SESSION,
      runtime,
      resolvedState: 'delta',
      runId: 'run-old',
    })).toMatchObject({ accept: false, reason: 'different-active-run' });
  });

  it('adopts an explicit external started event and rejects it after termination', () => {
    const idle = createIdleSessionRuntimeState();
    expect(decideRunEvent({
      sessionKey: SESSION,
      runtime: idle,
      resolvedState: 'started',
      runId: 'run-external',
    })).toMatchObject({ accept: true, bindRun: true });

    recordTerminalRun(SESSION, 'run-external');
    expect(decideRunEvent({
      sessionKey: SESSION,
      runtime: idle,
      resolvedState: 'started',
      runId: 'run-external',
    })).toMatchObject({ accept: false, reason: 'terminal' });
  });

  it('lets an uncertain local send bind its first valid run', () => {
    const runtime = {
      ...createIdleSessionRuntimeState(),
      sending: true,
      sendAcceptance: {
        idempotencyKey: 'message-1',
        status: 'uncertain' as const,
        startedAt: Date.now(),
      },
    };

    expect(decideRunEvent({
      sessionKey: SESSION,
      runtime,
      resolvedState: 'delta',
      runId: 'run-late-ack',
    })).toMatchObject({ accept: true, bindRun: true });
  });
});
