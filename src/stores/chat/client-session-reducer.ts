import { AppError } from '@/lib/error-model';
import type {
  CanonicalChatEvent,
  ChatRunPhase,
  ChatRuntimeSnapshot,
} from '../../../shared/chat-runtime-protocol';
import type { AttachedFileMeta, RawMessage, ToolStatus } from './types';
import { collectToolUpdates, isToolResultRole, upsertToolStatuses } from './helpers';
import { appendStreamingAssistantSnapshot } from './streaming-state';

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
  engineType: 'openclaw' | 'claude';
  epoch: number;
  sequence: number;
  startedAt: number;
  lastEventAt: number;
}

export interface ClientSessionState {
  transcript: RawMessage[];
  overlay: ChatTurnOverlay;
  runtime: ClientRunState | null;
  error: AppError | null;
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
    runtime: null,
    error: null,
    updatedAt: 0,
  };
}

export function applyRuntimeSnapshot(
  state: ClientSessionState,
  snapshot: ChatRuntimeSnapshot,
): ClientSessionState {
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
  if (current) {
    if (event.epoch < current.epoch) return { state, accepted: false, needsHydration: false };
    if (event.epoch === current.epoch && event.sequence <= current.sequence) {
      return { state, accepted: false, needsHydration: false };
    }
    if (event.epoch === current.epoch && event.sequence > current.sequence + 1) {
      return { state, accepted: false, needsHydration: true };
    }
  }

  const phase = phaseFromEvent(event, current);
  const terminal = phase === 'completed' || phase === 'failed' || phase === 'aborted' || phase === 'interrupted';
  const payload = event.payload && typeof event.payload === 'object'
    ? event.payload as Record<string, unknown>
    : null;
  const message = event.type === 'message.delta' || event.type === 'message.final'
    ? event.payload as RawMessage | null
    : event.type === 'tool.updated'
      ? event.payload as RawMessage | null
    : null;
  const errorMessage = event.type === 'run.failed' || event.type === 'run.interrupted'
    ? String(payload?.error ?? payload?.reason ?? 'Chat run failed')
    : null;
  const awaitingTranscript = event.type === 'message.final'
    || event.type === 'run.awaiting_transcript'
    || (phase === 'awaiting_transcript' && event.type !== 'message.delta');
  const startsNewRun = event.type === 'run.dispatching';
  const isToolResult = Boolean(message && isToolResultRole(message.role));
  const toolUpdates = message
    ? collectToolUpdates(message, event.type === 'message.delta' ? 'delta' : 'final')
    : [];
  const preserveCompletedOverlay = phase === 'completed' && Boolean(state.overlay.streamingMessage);
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
        streamingMessage: startsNewRun || clearOverlay
          ? null
          : isToolResult
            ? state.overlay.streamingMessage
            : message ?? state.overlay.streamingMessage,
        streamingMessages: startsNewRun || clearOverlay
          ? []
          : appendStreamingAssistantSnapshot(state.overlay.streamingMessages, message),
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
        awaitingTranscript: preserveCompletedOverlay || (!terminal && awaitingTranscript),
      },
      error: errorMessage ? new AppError('GATEWAY', errorMessage) : terminal ? null : state.error,
      updatedAt: event.occurredAt,
    },
  };
}
