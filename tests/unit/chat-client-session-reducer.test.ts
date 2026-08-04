import { describe, expect, it } from 'vitest';
import {
  applyRuntimeSnapshot,
  createClientSessionState,
  reduceSessionEvent,
} from '@/stores/chat/client-session-reducer';
import type { CanonicalChatEvent } from '../../shared/chat-runtime-protocol';

function event(overrides: Partial<CanonicalChatEvent> = {}): CanonicalChatEvent {
  return {
    protocolVersion: 1,
    eventId: 'event-1',
    sessionKey: 'agent:main:session-1',
    runId: 'run-1',
    idempotencyKey: 'message-1',
    engineType: 'openclaw',
    epoch: 1,
    sequence: 1,
    occurredAt: 100,
    type: 'run.started',
    ...overrides,
  };
}

describe('canonical chat client session reducer', () => {
  it('applies ordered lifecycle events to one explicit run phase', () => {
    const started = reduceSessionEvent(createClientSessionState(), event());
    expect(started.state.runtime).toMatchObject({ phase: 'running', runId: 'run-1', sequence: 1 });

    const final = reduceSessionEvent(started.state, event({
      eventId: 'event-2',
      sequence: 2,
      type: 'message.final',
      payload: { role: 'assistant', content: 'done' },
    }));
    expect(final.state.runtime?.phase).toBe('running');
    expect(final.state.overlay.awaitingTranscript).toBe(true);

    const awaiting = reduceSessionEvent(final.state, event({
      eventId: 'event-3', sequence: 3, type: 'run.awaiting_transcript',
    }));
    expect(awaiting.state.runtime?.phase).toBe('awaiting_transcript');
    expect(awaiting.state.overlay.awaitingTranscript).toBe(true);

    const completed = reduceSessionEvent(awaiting.state, event({
      eventId: 'event-4', sequence: 4, type: 'run.completed',
    }));
    expect(completed.state.runtime?.phase).toBe('completed');
    expect(completed.state.overlay.streamingMessage).toMatchObject({ content: 'done' });
    expect(completed.state.overlay.awaitingTranscript).toBe(true);
  });

  it('rejects duplicates and requests hydration for sequence gaps', () => {
    const started = reduceSessionEvent(createClientSessionState(), event()).state;
    expect(reduceSessionEvent(started, event()).accepted).toBe(false);
    expect(reduceSessionEvent(started, event({ sequence: 3 })).needsHydration).toBe(true);
  });

  it('accepts a new epoch after main-process recovery', () => {
    const old = reduceSessionEvent(createClientSessionState(), event({ sequence: 4 })).state;
    const recovered = reduceSessionEvent(old, event({
      epoch: 2,
      sequence: 1,
      type: 'run.started',
      occurredAt: 200,
    }));
    expect(recovered.accepted).toBe(true);
    expect(recovered.state.runtime).toMatchObject({ epoch: 2, sequence: 1, startedAt: 200 });
  });

  it('rejects events from an older epoch', () => {
    const current = reduceSessionEvent(createClientSessionState(), event({ epoch: 2 })).state;
    expect(reduceSessionEvent(current, event({ epoch: 1, sequence: 99 })).accepted).toBe(false);
  });

  it('does not let a stale hydration snapshot replace a newer event state', () => {
    const current = reduceSessionEvent(createClientSessionState(), event({ epoch: 3, sequence: 9 })).state;
    const next = applyRuntimeSnapshot(current, {
      protocolVersion: 1,
      sessionKey: event().sessionKey,
      runId: 'run-old',
      idempotencyKey: 'message-old',
      runtimePolicy: { origin: 'interactive', deadlineAt: null },
      engineType: 'openclaw',
      phase: 'running',
      epoch: 3,
      sequence: 8,
      startedAt: 1,
      lastEventAt: 1,
      terminalAt: null,
      error: null,
      acceptanceResult: null,
      updatedAt: 1,
    });
    expect(next).toBe(current);
  });
});
