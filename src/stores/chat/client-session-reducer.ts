import { AppError } from '@/lib/error-model';
import {
  formatChatRuntimeErrorMessage,
  resolveChatRuntimeErrorCode,
} from './runtime-error-message';
import type {
  CanonicalChatEvent,
  ChatRunPhase,
  ChatRuntimeSnapshot,
} from '../../../shared/chat-runtime-protocol';
import { isTerminalChatRunPhase } from '../../../shared/chat-runtime-protocol';
import type { AttachedFileMeta, RawMessage, ToolStatus } from './types';
import { collectToolUpdates, isToolResultRole, upsertToolStatuses } from './helpers';
import { appendStreamingAssistantSnapshot } from './streaming-state';

interface ChatDispatchPayload {
  idempotencyKey: string;
  optimisticUserMessage?: RawMessage;
}

export interface ChatTurnOverlay {
  optimisticUserMessage: RawMessage | null;
  streamingMessage: RawMessage | null;
  streamingMessages: RawMessage[];
  streamingToolResults: RawMessage[];
  streamingTools: ToolStatus[];
  pendingAttachments: AttachedFileMeta[];
  awaitingTranscript: boolean;
}

export interface ClientRunState {
  phase: ChatRunPhase;
  runId: string | null;
  idempotencyKey: string | null;
  engineType: 'openclaw' | 'claude' | 'pi';
  epoch: number;
  sequence: number;
  startedAt: number;
  lastEventAt: number;
}

export interface ClientSessionSyncState {
  status: 'uninitialized' | 'hydrating' | 'ready' | 'gapped';
  hydrationGeneration: number;
  pendingEvents: CanonicalChatEvent[];
  retryCount: number;
  retryAt: number | null;
  bufferOverflowed: boolean;
}

export interface ChatMessageDecorations {
  /** Derived display-only projection. Raw transcript remains untouched. */
  projectedMessages: RawMessage[] | null;
}

export interface ClientSessionState {
  transcript: RawMessage[];
  overlay: ChatTurnOverlay;
  decorations: ChatMessageDecorations;
  runtime: ClientRunState | null;
  error: AppError | null;
  sync: ClientSessionSyncState;
  updatedAt: number;
}

export interface SessionEventReduction {
  state: ClientSessionState;
  needsHydration: boolean;
  accepted: boolean;
}

export function createClientSessionState(): ClientSessionState {
  return {
    transcript: [],
    overlay: {
      optimisticUserMessage: null,
      streamingMessage: null,
      streamingMessages: [],
      streamingToolResults: [],
      streamingTools: [],
      pendingAttachments: [],
      awaitingTranscript: false,
    },
    decorations: { projectedMessages: null },
    runtime: null,
    error: null,
    sync: {
      status: 'uninitialized',
      hydrationGeneration: 0,
      pendingEvents: [],
      retryCount: 0,
      retryAt: null,
      bufferOverflowed: false,
    },
    updatedAt: 0,
  };
}

export function isSnapshotNewer(
  state: ClientSessionState,
  snapshot: ChatRuntimeSnapshot,
): boolean {
  const current = state.runtime;
  if (!current) return true;
  if (snapshot.epoch !== current.epoch) return snapshot.epoch > current.epoch;
  if (snapshot.sequence < current.sequence) return false;
  if (snapshot.sequence === current.sequence) {
    return isTerminalChatRunPhase(snapshot.phase) && !isTerminalChatRunPhase(current.phase);
  }
  if (isTerminalChatRunPhase(current.phase) && !isTerminalChatRunPhase(snapshot.phase)) return false;
  return true;
}

export function applyRuntimeSnapshot(
  state: ClientSessionState,
  snapshot: ChatRuntimeSnapshot,
): ClientSessionState {
  if (!isSnapshotNewer(state, snapshot)) return state;
  return {
    ...state,
    runtime: {
      phase: snapshot.phase,
      runId: snapshot.runId,
      idempotencyKey: snapshot.idempotencyKey,
      engineType: snapshot.engineType,
      epoch: snapshot.epoch,
      sequence: snapshot.sequence,
      startedAt: snapshot.startedAt,
      lastEventAt: snapshot.lastEventAt,
    },
    error: snapshot.error ? new AppError('GATEWAY', snapshot.error) : null,
    overlay: {
      ...state.overlay,
      awaitingTranscript: snapshot.phase === 'awaiting_transcript',
    },
    sync: {
      ...state.sync,
      status: 'ready',
      retryCount: 0,
      retryAt: null,
    },
    updatedAt: snapshot.updatedAt,
  };
}

function phaseFromEvent(event: CanonicalChatEvent, current: ClientRunState | null): ChatRunPhase {
  switch (event.type) {
    case 'run.dispatching': return 'dispatching';
    case 'run.accepted':
    case 'run.started':
    case 'message.delta':
    case 'tool.updated': return 'running';
    case 'message.final': return current?.phase ?? 'running';
    case 'transcript.updated': return current?.phase ?? 'completed';
    case 'run.awaiting_transcript': return 'awaiting_transcript';
    case 'run.completed': return 'completed';
    case 'run.failed': return 'failed';
    case 'run.aborted': return 'aborted';
    case 'run.interrupted': return 'interrupted';
  }
}

export function reduceSessionEvent(
  state: ClientSessionState,
  event: CanonicalChatEvent,
): SessionEventReduction {
  const current = state.runtime;
  const phase = phaseFromEvent(event, current);
  if (current) {
    if (event.epoch < current.epoch) return { state, accepted: false, needsHydration: false };
    if (event.epoch === current.epoch && event.sequence < current.sequence) {
      return { state, accepted: false, needsHydration: false };
    }
    if (
      event.epoch === current.epoch
      && event.sequence === current.sequence
      && (!isTerminalChatRunPhase(phase) || isTerminalChatRunPhase(current.phase))
    ) return { state, accepted: false, needsHydration: false };
    if (event.epoch === current.epoch && event.sequence > current.sequence + 1) {
      return { state, accepted: false, needsHydration: true };
    }
    if (event.epoch === current.epoch && current.runId && event.runId && current.runId !== event.runId) {
      return { state, accepted: false, needsHydration: true };
    }
    if (
      event.epoch === current.epoch
      && isTerminalChatRunPhase(current.phase)
      && event.type !== 'transcript.updated'
    ) {
      return { state, accepted: false, needsHydration: false };
    }
  }

  const terminal = phase === 'completed' || phase === 'failed' || phase === 'aborted' || phase === 'interrupted';
  const payload = event.payload && typeof event.payload === 'object'
    ? event.payload as Record<string, unknown>
    : null;
  const message = event.type === 'message.delta' || event.type === 'message.final'
    ? event.payload as RawMessage | null
    : event.type === 'tool.updated'
      ? event.payload as RawMessage | null
    : null;
  const isSupersededInterruption = event.type === 'run.interrupted'
    && payload?.reason === 'superseded';
  const errorMessage = (event.type === 'run.failed' || event.type === 'run.interrupted')
    && !isSupersededInterruption
    ? formatChatRuntimeErrorMessage(payload, 'Chat run failed')
    : null;
  const errorCode = (event.type === 'run.failed' || event.type === 'run.interrupted')
    && !isSupersededInterruption
    ? resolveChatRuntimeErrorCode(payload, 'Chat run failed')
    : null;
  const awaitingTranscript = event.type === 'message.final'
    || event.type === 'run.awaiting_transcript'
    || (phase === 'awaiting_transcript' && event.type !== 'message.delta');
  const startsNewRun = event.type === 'run.dispatching';
  const dispatchPayload = startsNewRun ? payload as ChatDispatchPayload | null : null;
  const dispatchUserMessage = dispatchPayload?.optimisticUserMessage ?? null;
  const currentOptimisticBelongsToRun = startsNewRun
    && Boolean(event.idempotencyKey)
    && state.overlay.optimisticUserMessage?.id === event.idempotencyKey;
  const preserveExistingOptimistic = currentOptimisticBelongsToRun
    || Boolean(state.overlay.optimisticUserMessage);
  const isToolResult = Boolean(message && isToolResultRole(message.role));
  const toolUpdates = message
    ? collectToolUpdates(message, event.type === 'message.delta' ? 'delta' : 'final')
    : [];
  const hasLiveOverlay = Boolean(
    state.overlay.streamingMessage
    || state.overlay.streamingMessages.length > 0
    || state.overlay.streamingToolResults.length > 0
    || state.overlay.streamingTools.length > 0,
  );
  const preserveCompletedOverlay = phase === 'completed' && hasLiveOverlay;
  const clearOverlay = phase === 'failed' || phase === 'aborted' || phase === 'interrupted';

  return {
    accepted: true,
    needsHydration: false,
    state: {
      ...state,
      runtime: {
        phase,
        runId: event.runId,
        idempotencyKey: event.idempotencyKey ?? current?.idempotencyKey ?? null,
        engineType: event.engineType,
        epoch: event.epoch,
        sequence: event.sequence,
        startedAt: current && current.epoch === event.epoch ? current.startedAt : event.occurredAt,
        lastEventAt: event.occurredAt,
      },
      overlay: {
        ...state.overlay,
        optimisticUserMessage: startsNewRun
          ? preserveExistingOptimistic
            ? state.overlay.optimisticUserMessage
            : dispatchUserMessage ?? state.overlay.optimisticUserMessage
          : state.overlay.optimisticUserMessage,
        streamingMessage: startsNewRun || clearOverlay
          ? null
          : isToolResult
            ? state.overlay.streamingMessage
            : message ?? state.overlay.streamingMessage,
        streamingMessages: startsNewRun || clearOverlay
          ? []
          // Keep only committed assistant messages in the chronological buffer.
          // The current growing delta already lives in streamingMessage. Mixing
          // it into this array makes a reused run id jump back to its first
          // position across multi-message runs and leaves rendering one message
          // behind until transcript reload.
          : event.type === 'message.final'
            ? appendStreamingAssistantSnapshot(state.overlay.streamingMessages, message)
            : state.overlay.streamingMessages,
        streamingToolResults: startsNewRun || clearOverlay
          ? []
          : isToolResult && message
            ? [...state.overlay.streamingToolResults, message]
            : state.overlay.streamingToolResults,
        streamingTools: startsNewRun || clearOverlay
          ? []
          : toolUpdates.length > 0
            ? upsertToolStatuses(state.overlay.streamingTools, toolUpdates)
            : state.overlay.streamingTools,
        // transcript.updated only announces that authoritative history changed.
        // Keep the final overlay mounted until setTranscript verifies that the
        // current user turn and assistant reply are both present; clearing here
        // creates a blank frame while the async history refresh is still pending.
        awaitingTranscript: preserveCompletedOverlay || (!terminal && awaitingTranscript),
      },
      error: startsNewRun
        ? null
        : errorMessage
          ? new AppError(errorCode ?? 'GATEWAY', errorMessage, undefined, {
            reason: typeof payload?.reason === 'string' ? payload.reason : undefined,
          })
          : terminal
            ? null
            : state.error,
      updatedAt: event.occurredAt,
    },
  };
}
