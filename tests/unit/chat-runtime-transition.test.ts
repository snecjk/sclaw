import { describe, expect, it } from 'vitest';
import {
  CHAT_RUNTIME_ALLOWED_TRANSITIONS,
  CHAT_RUNTIME_EVENT_TARGET_PHASE,
  transitionChatRuntime,
  transitionChatRuntimePhase,
} from '../../electron/services/chat-runtime-transition';
import {
  CANONICAL_CHAT_EVENT_TYPES,
  CHAT_RUN_PHASES,
  isTerminalChatRunPhase,
  type CanonicalChatEventType,
  type ChatRunPhase,
  type ChatRuntimeSnapshot,
} from '../../shared/chat-runtime-protocol';

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
    interruptCause: null,
    acceptanceResult: null,
    updatedAt: 1,
    ...overrides,
  };
}

/**
 * 与生产 ALLOWED 独立声明。改一格必须同时改这张表，否则穷举测试红。
 * 不要从 CHAT_RUNTIME_ALLOWED_TRANSITIONS 派生。
 */
const EXPECTED_ALLOWED: Record<ChatRunPhase, readonly ChatRunPhase[]> = {
  dispatching: [
    'dispatching', 'uncertain', 'running', 'awaiting_transcript', 'aborting',
    'completed', 'failed', 'aborted', 'interrupted',
  ],
  uncertain: ['uncertain', 'running', 'aborting', 'reconciling', 'failed', 'aborted', 'interrupted'],
  running: ['running', 'awaiting_transcript', 'aborting', 'reconciling', 'completed', 'failed', 'aborted', 'interrupted'],
  awaiting_transcript: [
    'awaiting_transcript', 'running', 'aborting', 'reconciling', 'completed', 'failed', 'aborted', 'interrupted',
  ],
  aborting: ['aborting', 'running', 'completed', 'aborted', 'interrupted'],
  reconciling: [
    'reconciling', 'running', 'awaiting_transcript', 'aborting', 'completed', 'failed', 'aborted', 'interrupted',
  ],
  completed: ['completed'],
  failed: ['failed'],
  aborted: ['aborted'],
  interrupted: ['interrupted'],
};

const EXPECTED_TARGET: Record<CanonicalChatEventType, ChatRunPhase | null> = {
  'run.dispatching': 'dispatching',
  'run.accepted': 'running',
  'run.started': 'running',
  'message.delta': 'running',
  'message.final': null,
  'tool.updated': 'running',
  'transcript.updated': null,
  'run.awaiting_transcript': 'awaiting_transcript',
  'run.completed': 'completed',
  'run.failed': 'failed',
  'run.aborted': 'aborted',
  'run.interrupted': 'interrupted',
};

function expectedOutcome(phase: ChatRunPhase, type: CanonicalChatEventType): {
  accepted: boolean;
  reason?: 'terminal-is-immutable' | 'invalid-transition';
  nextPhase?: ChatRunPhase;
} {
  const target = EXPECTED_TARGET[type] ?? phase;
  const nextPhase = target ?? phase;
  if (isTerminalChatRunPhase(phase) && nextPhase !== phase) {
    return { accepted: false, reason: 'terminal-is-immutable' };
  }
  if (!EXPECTED_ALLOWED[phase].includes(nextPhase)) {
    return { accepted: false, reason: 'invalid-transition' };
  }
  return { accepted: true, nextPhase };
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
      snapshot: snapshot({ phase: 'running' }),
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

  it('ALLOWED 与独立契约表必须逐格一致', () => {
    for (const phase of CHAT_RUN_PHASES) {
      expect([...CHAT_RUNTIME_ALLOWED_TRANSITIONS[phase]].sort()).toEqual(
        [...EXPECTED_ALLOWED[phase]].sort(),
      );
    }
    for (const type of CANONICAL_CHAT_EVENT_TYPES) {
      expect(CHAT_RUNTIME_EVENT_TARGET_PHASE[type]).toBe(EXPECTED_TARGET[type]);
    }
  });

  it.each(
    CHAT_RUN_PHASES.flatMap((phase) =>
      CANONICAL_CHAT_EVENT_TYPES.map((type) => ({ phase, type })),
    ),
  )('$phase × $type', ({ phase, type }) => {
    const current = snapshot({
      phase,
      terminalAt: isTerminalChatRunPhase(phase) ? 10 : null,
    });
    const result = transitionChatRuntime({
      snapshot: current,
      type,
      occurredAt: 20,
    });
    const expected = expectedOutcome(phase, type);
    if (!expected.accepted) {
      expect(result).toEqual({ accepted: false, reason: expected.reason });
      return;
    }
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.snapshot.phase).toBe(expected.nextPhase);
    }
  });
});
