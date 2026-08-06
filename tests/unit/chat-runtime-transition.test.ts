import { describe, expect, it } from 'vitest';
import {
  transitionChatRuntime,
  transitionChatRuntimePhase,
} from '../../electron/services/chat-runtime-transition';
import type { ChatRunPhase } from '../../shared/chat-runtime-protocol';
import type { ChatRuntimeSnapshot } from '../../shared/chat-runtime-protocol';

function snapshot(overrides: Partial<ChatRuntimeSnapshot> = {}): ChatRuntimeSnapshot {
  return {
    protocolVersion: 1,
    sessionKey: 'agent:main:transition',
    runId: 'run-1',
    idempotencyKey: 'message-1',
    runtimePolicy: { origin: 'interactive', deadlineAt: null },
    engineType: 'openclaw',
    phase: 'running',
    epoch: 1,
    sequence: 4,
    startedAt: 1,
    lastEventAt: 1,
    terminalAt: null,
    error: null,
    acceptanceResult: null,
    updatedAt: 1,
    ...overrides,
  };
}

describe('chat runtime transition', () => {
  it('makes terminal phases immutable', () => {
    const result = transitionChatRuntime({
      snapshot: snapshot({ phase: 'completed', terminalAt: 10 }),
      type: 'run.accepted',
      occurredAt: 20,
    });
    expect(result).toEqual({ accepted: false, reason: 'terminal-is-immutable' });
  });

  it('allows transcript revision notification without reopening a terminal run', () => {
    const result = transitionChatRuntime({
      snapshot: snapshot({ phase: 'completed', terminalAt: 10 }),
      type: 'transcript.updated',
      occurredAt: 20,
    });
    expect(result.accepted && result.snapshot).toMatchObject({
      phase: 'completed',
      sequence: 5,
      terminalAt: 10,
    });
  });

  it('rejects a mismatched run id', () => {
    const result = transitionChatRuntime({
      snapshot: snapshot(),
      type: 'message.delta',
      occurredAt: 20,
      runId: 'run-2',
    });
    expect(result).toEqual({ accepted: false, reason: 'run-id-mismatch' });
  });

  it('allows abort failure to return aborting to running', () => {
    const result = transitionChatRuntime({
      snapshot: snapshot({ phase: 'aborting' }),
      type: 'run.started',
      occurredAt: 20,
    });
    expect(result.accepted && result.snapshot.phase).toBe('running');
  });

  it.each<ChatRunPhase>([
    'dispatching',
    'uncertain',
    'running',
    'awaiting_transcript',
    'reconciling',
  ])('allows a user stop to enter aborting from %s', (phase) => {
    const result = transitionChatRuntimePhase({
      snapshot: snapshot({ phase }),
      phase: 'aborting',
      occurredAt: 20,
    });

    expect(result.accepted && result.snapshot.phase).toBe('aborting');
  });

  it.each<ChatRunPhase>([
    'dispatching',
    'uncertain',
    'running',
    'awaiting_transcript',
    'reconciling',
  ])('accepts an engine abort acknowledgement from %s', (phase) => {
    const result = transitionChatRuntime({
      snapshot: snapshot({ phase }),
      type: 'run.aborted',
      occurredAt: 20,
    });

    expect(result.accepted && result.snapshot).toMatchObject({
      phase: 'aborted',
      terminalAt: 20,
    });
  });
});
