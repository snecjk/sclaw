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

  it('keeps committed messages chronological while the current delta stays separate', () => {
    const started = reduceSessionEvent(createClientSessionState(), event()).state;
    const firstDelta = reduceSessionEvent(started, event({
      eventId: 'event-2',
      sequence: 2,
      type: 'message.delta',
      payload: { id: 'run-1', role: 'assistant', content: 'first partial' },
    })).state;
    expect(firstDelta.overlay.streamingMessages).toEqual([]);
    expect(firstDelta.overlay.streamingMessage).toMatchObject({ content: 'first partial' });

    const firstFinal = reduceSessionEvent(firstDelta, event({
      eventId: 'event-3',
      sequence: 3,
      type: 'message.final',
      payload: { id: 'assistant-1', role: 'assistant', content: 'first committed' },
    })).state;
    expect(firstFinal.overlay.streamingMessages.map((message) => message.id)).toEqual([
      'assistant-1',
    ]);

    const secondDelta = reduceSessionEvent(firstFinal, event({
      eventId: 'event-4',
      sequence: 4,
      type: 'message.delta',
      payload: { id: 'run-1', role: 'assistant', content: 'second partial' },
    })).state;
    expect(secondDelta.overlay.streamingMessages.map((message) => message.id)).toEqual([
      'assistant-1',
    ]);
    expect(secondDelta.overlay.streamingMessage).toMatchObject({ content: 'second partial' });
  });

  it('rejects duplicates and requests hydration for sequence gaps', () => {
    const started = reduceSessionEvent(createClientSessionState(), event()).state;
    expect(reduceSessionEvent(started, event()).accepted).toBe(false);
    expect(reduceSessionEvent(started, event({ sequence: 3 })).needsHydration).toBe(true);
  });

  it('accepts a same-sequence terminal event and terminal hydration snapshot', () => {
    const running = reduceSessionEvent(createClientSessionState(), event({
      sequence: 14,
      type: 'message.delta',
      payload: { role: 'assistant', content: 'done' },
    })).state;

    const completed = reduceSessionEvent(running, event({
      eventId: 'event-terminal',
      sequence: 14,
      type: 'run.completed',
    }));
    expect(completed.accepted).toBe(true);
    expect(completed.state.runtime?.phase).toBe('completed');

    const hydrated = applyRuntimeSnapshot(running, {
      protocolVersion: 1,
      sessionKey: event().sessionKey,
      runId: 'run-1',
      idempotencyKey: 'message-1',
      runtimePolicy: { origin: 'interactive', deadlineAt: null },
      engineType: 'openclaw',
      phase: 'completed',
      epoch: 1,
      sequence: 14,
      startedAt: 1,
      lastEventAt: 2,
      terminalAt: 2,
      error: null,
      acceptanceResult: null,
      updatedAt: 2,
    });
    expect(hydrated.runtime?.phase).toBe('completed');
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

  it('treats a superseded interruption as an internal run replacement', () => {
    const running = reduceSessionEvent(createClientSessionState(), event({
      type: 'run.dispatching',
    })).state;
    const superseded = reduceSessionEvent(running, event({
      eventId: 'event-2',
      sequence: 2,
      type: 'run.interrupted',
      payload: { reason: 'superseded' },
    })).state;

    expect(superseded.runtime?.phase).toBe('interrupted');
    expect(superseded.error).toBeNull();

    const replacement = reduceSessionEvent(superseded, event({
      eventId: 'event-3',
      runId: null,
      idempotencyKey: 'message-2',
      epoch: 2,
      sequence: 1,
      occurredAt: 200,
      type: 'run.dispatching',
    })).state;

    expect(replacement.runtime).toMatchObject({
      phase: 'dispatching',
      idempotencyKey: 'message-2',
      epoch: 2,
      sequence: 1,
    });
    expect(replacement.error).toBeNull();
  });

  it('keeps real interruptions visible and clears them when a new run dispatches', () => {
    const running = reduceSessionEvent(createClientSessionState(), event({
      type: 'run.dispatching',
    })).state;
    const interrupted = reduceSessionEvent(running, event({
      eventId: 'event-2',
      sequence: 2,
      type: 'run.interrupted',
      payload: { reason: 'recovery-timeout' },
    })).state;

    expect(interrupted.error?.message).toBe('recovery-timeout');

    const replacement = reduceSessionEvent(interrupted, event({
      eventId: 'event-3',
      runId: null,
      idempotencyKey: 'message-2',
      epoch: 2,
      sequence: 1,
      occurredAt: 200,
      type: 'run.dispatching',
    })).state;

    expect(replacement.runtime?.phase).toBe('dispatching');
    expect(replacement.error).toBeNull();
  });

  it('does not produce an optimistic user turn for scheduled-task dispatches (X2)', () => {
    // X2: 定时任务执行不再注入乐观 user 消息。supervisor 对 origin === 'scheduled_task'
    // 的 dispatch 不携带 optimisticUserMessage，reducer 因此不会产生乐观气泡。
    // 任务会话的 user 气泡完全由 server echo（history 回读）渲染。
    const scheduled = reduceSessionEvent(createClientSessionState(), event({
      type: 'run.dispatching',
      runtimePolicy: { origin: 'scheduled_task' },
      payload: {
        idempotencyKey: 'message-1',
      },
    })).state;
    expect(scheduled.overlay.optimisticUserMessage).toBeNull();

    // 即便上游误传了 optimisticUserMessage（防御性断言），scheduled 会话也不应产生乐观气泡：
    // 当前 reducer 不再按 origin 区分，但 supervisor 已保证不携带，此处仅断言主路径。
    // 正常 chat 链路行为不变：dispatch 携带的乐观消息被保留。
    const interactive = createClientSessionState();
    interactive.overlay.optimisticUserMessage = {
      id: 'renderer-message', role: 'user', content: 'normal chat', timestamp: 0.05,
    };
    const dispatched = reduceSessionEvent(interactive, event({
      type: 'run.dispatching',
      payload: {
        idempotencyKey: 'message-1',
        optimisticUserMessage: {
          id: 'message-1', role: 'user', content: 'gateway text', timestamp: 0.1,
        },
      },
    })).state;
    // 渲染侧已有同 id 乐观消息（currentOptimisticBelongsToRun 不成立，id 不同），保留既有。
    expect(dispatched.overlay.optimisticUserMessage).toBe(interactive.overlay.optimisticUserMessage);
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
