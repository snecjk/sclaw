import {
  isTerminalChatRunPhase,
  type CanonicalChatEventType,
  type ChatRunPhase,
  type ChatRuntimeSnapshot,
} from '../../shared/chat-runtime-protocol';

export const CHAT_RUNTIME_EVENT_TARGET_PHASE: Record<CanonicalChatEventType, ChatRunPhase | null> = {
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

export const CHAT_RUNTIME_ALLOWED_TRANSITIONS: Record<ChatRunPhase, ReadonlySet<ChatRunPhase>> = {
  dispatching: new Set([
    'dispatching', 'uncertain', 'running', 'awaiting_transcript', 'aborting',
    'completed', 'failed', 'aborted', 'interrupted',
  ]),
  uncertain: new Set(['uncertain', 'running', 'aborting', 'reconciling', 'failed', 'aborted', 'interrupted']),
  running: new Set(['running', 'awaiting_transcript', 'aborting', 'reconciling', 'completed', 'failed', 'aborted', 'interrupted']),
  awaiting_transcript: new Set(['awaiting_transcript', 'running', 'aborting', 'reconciling', 'completed', 'failed', 'aborted', 'interrupted']),
  aborting: new Set(['aborting', 'running', 'completed', 'aborted', 'interrupted']),
  reconciling: new Set(['reconciling', 'running', 'awaiting_transcript', 'aborting', 'completed', 'failed', 'aborted', 'interrupted']),
  completed: new Set(['completed']),
  failed: new Set(['failed']),
  aborted: new Set(['aborted']),
  interrupted: new Set(['interrupted']),
};

export type ChatRuntimeTransitionResult =
  | { accepted: true; snapshot: ChatRuntimeSnapshot }
  | {
      accepted: false;
      reason: 'terminal-is-immutable' | 'invalid-transition' | 'run-id-mismatch';
    };

export function transitionChatRuntime(input: {
  snapshot: ChatRuntimeSnapshot;
  type: CanonicalChatEventType;
  occurredAt: number;
  patch?: Partial<ChatRuntimeSnapshot>;
  runId?: string | null;
}): ChatRuntimeTransitionResult {
  const { snapshot, type, occurredAt, patch } = input;
  if (snapshot.runId && input.runId && snapshot.runId !== input.runId) {
    return { accepted: false, reason: 'run-id-mismatch' };
  }

  const target = CHAT_RUNTIME_EVENT_TARGET_PHASE[type] ?? snapshot.phase;
  const nextPhase = target ?? snapshot.phase;
  if (isTerminalChatRunPhase(snapshot.phase) && nextPhase !== snapshot.phase) {
    return { accepted: false, reason: 'terminal-is-immutable' };
  }
  if (!CHAT_RUNTIME_ALLOWED_TRANSITIONS[snapshot.phase].has(nextPhase)) {
    return { accepted: false, reason: 'invalid-transition' };
  }

  return {
    accepted: true,
    snapshot: {
      ...snapshot,
      ...patch,
      runId: input.runId ?? patch?.runId ?? snapshot.runId,
      phase: nextPhase,
      sequence: snapshot.sequence + 1,
      lastEventAt: occurredAt,
      terminalAt: isTerminalChatRunPhase(nextPhase) ? snapshot.terminalAt ?? occurredAt : null,
      updatedAt: occurredAt,
    },
  };
}

export function patchTerminalRuntimeMetadata(
  snapshot: ChatRuntimeSnapshot,
  patch: Pick<Partial<ChatRuntimeSnapshot>, 'runId' | 'acceptanceResult' | 'error'>,
  occurredAt = Date.now(),
): ChatRuntimeSnapshot {
  return {
    ...snapshot,
    ...patch,
    phase: snapshot.phase,
    sequence: snapshot.sequence,
    terminalAt: snapshot.terminalAt,
    updatedAt: occurredAt,
  };
}

export function transitionChatRuntimePhase(input: {
  snapshot: ChatRuntimeSnapshot;
  phase: ChatRunPhase;
  occurredAt: number;
  patch?: Partial<ChatRuntimeSnapshot>;
}): ChatRuntimeTransitionResult {
  const { snapshot, phase, occurredAt, patch } = input;
  if (isTerminalChatRunPhase(snapshot.phase) && phase !== snapshot.phase) {
    return { accepted: false, reason: 'terminal-is-immutable' };
  }
  if (!CHAT_RUNTIME_ALLOWED_TRANSITIONS[snapshot.phase].has(phase)) {
    return { accepted: false, reason: 'invalid-transition' };
  }
  return {
    accepted: true,
    snapshot: {
      ...snapshot,
      ...patch,
      phase,
      lastEventAt: occurredAt,
      terminalAt: isTerminalChatRunPhase(phase) ? snapshot.terminalAt ?? occurredAt : null,
      updatedAt: occurredAt,
    },
  };
}
