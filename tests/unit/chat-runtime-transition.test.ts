import { describe, expect, it } from 'vitest';
import { transitionChatRuntime } from '../../electron/services/chat-runtime-transition';
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
});
