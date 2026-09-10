import { AppError } from '@/lib/error-model';
import {
  formatChatRuntimeErrorMessage,
  resolveChatRuntimeErrorCode,
} from './runtime-error-message';
import type {
  CanonicalChatEvent,
  ChatRunPhase,
  ChatRuntimeSnapshot,
  ContextCompactionActivity,
  ContextCompactionReason,
  ChatContextUsage,
} from '../../../shared/chat-runtime-protocol';
import { isTerminalChatRunPhase } from '../../../shared/chat-runtime-protocol';
import type { ChatHistoryFingerprint } from '../../../shared/chat-history-fingerprint';
import type { ChatHistoryCapabilities } from '../../../shared/chat-history-capabilities';
import type { AttachedFileMeta, RawMessage, ToolStatus } from './types';
import { truncateToolPayload } from '../../../shared/chat-tool-payload';
import { collectToolUpdates, isToolResultRole, upsertToolStatuses } from './helpers';
import { isAgentPreparationProgressMessage } from '@/lib/agent-preparation-progress';
import { appendStreamingAssistantSnapshot, appendStreamingToolResultSnapshot, STREAMING_OVERLAY_BUFFER_LIMIT } from './streaming-state';
import { applyLiveMessagePayload, materializeLiveMessage } from '../../../shared/chat-live-append';

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
  /** Unique tool ids observed this run; not capped with the overlay window. */
  toolEventCount: number;
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
  activity?: ContextCompactionActivity | null;
  contextUsage?: ChatContextUsage | null;
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
  historyFingerprint: ChatHistoryFingerprint | null;
  historyTotalCount: number;
  historyCapabilities: ChatHistoryCapabilities | null;
}

export interface SessionEventReduction {
  state: ClientSessionState;
  needsHydration: boolean;
  accepted: boolean;
}

function upsertPreparationProgressMessage(
  messages: RawMessage[],
  message: RawMessage,
): RawMessage[] {
  const index = messages.findIndex((item) => item.id === message.id);
  if (index < 0) return [...messages, message];
  const next = [...messages];
  next[index] = message;
  return next;
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
      toolEventCount: 0,
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
    historyFingerprint: null,
    historyTotalCount: 0,
    historyCapabilities: null,
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
      activity: snapshot.activity ?? null,
      contextUsage: snapshot.contextUsage ?? null,
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
    case 'context.compaction.started':
    case 'context.compaction.completed':
    case 'context.compaction.failed':
      // Context maintenance is out-of-band. When it is the first event seen by
      // this renderer, it must not manufacture an active chat turn; automatic
      // compaction during a real turn still preserves that turn's current phase.
      return current?.phase ?? 'completed';
    case 'context.usage.updated': return current?.phase ?? 'completed';
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
  const isContextEvent = event.type.startsWith('context.');
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
      // 累计 delta 可合帧成最新一条，sequence 会跳号；缺的是中间快照不是丢事件。
      if (event.type !== 'message.delta') {
        return { state, accepted: false, needsHydration: true };
      }
    }
    if (!isContextEvent && event.epoch === current.epoch && current.runId && event.runId && current.runId !== event.runId) {
      return { state, accepted: false, needsHydration: true };
    }
    if (
      event.epoch === current.epoch
      && isTerminalChatRunPhase(current.phase)
      && event.type !== 'transcript.updated'
      && !isContextEvent
    ) {
      return { state, accepted: false, needsHydration: false };
    }
  }

  const terminal = phase === 'completed' || phase === 'failed' || phase === 'aborted' || phase === 'interrupted';
  const payload = event.payload && typeof event.payload === 'object'
    ? event.payload as Record<string, unknown>
    : null;
  const message = event.type === 'message.delta'
    ? applyLiveMessagePayload(state.overlay.streamingMessage, event.payload) as RawMessage | null
    : event.type === 'message.final'
      ? materializeLiveMessage(event.payload as RawMessage | null) as RawMessage | null
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
  const isPreparationProgress = isAgentPreparationProgressMessage(message);
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
  const nextStreamingTools = startsNewRun || clearOverlay
    ? []
    : toolUpdates.length > 0
      ? upsertToolStatuses(
        state.overlay.streamingTools,
        toolUpdates.map((update) => ({
          ...update,
          input: truncateToolPayload(update.input),
        })),
      ).slice(-STREAMING_OVERLAY_BUFFER_LIMIT)
      : state.overlay.streamingTools;
  const newToolKeys = nextStreamingTools.filter((tool) => {
    const key = tool.toolCallId || tool.id || tool.name;
    if (!key) return false;
    return !state.overlay.streamingTools.some(
      (existing) => (existing.toolCallId || existing.id || existing.name) === key,
    );
  }).length;
  const nextToolEventCount = startsNewRun || clearOverlay
    ? newToolKeys
    : (state.overlay.toolEventCount ?? 0) + newToolKeys;
  const compactionReason = payload?.reason;
  const normalizedCompactionReason: ContextCompactionReason =
    compactionReason === 'manual'
    || compactionReason === 'threshold'
    || compactionReason === 'overflow'
    || compactionReason === 'auto'
      ? compactionReason
      : 'unknown';
  const compactionAttemptId = typeof payload?.attemptId === 'string' ? payload.attemptId : '';
  const terminalEvent = event.type === 'run.completed'
    || event.type === 'run.failed'
    || event.type === 'run.aborted'
    || event.type === 'run.interrupted';
  let nextActivity = startsNewRun || terminalEvent ? null : current?.activity ?? null;
  if (event.type === 'context.compaction.started' && compactionAttemptId) {
    nextActivity = {
      type: 'context_compaction',
      attemptId: compactionAttemptId,
      status: 'running',
      reason: normalizedCompactionReason,
      startedAt: event.occurredAt,
    };
  } else if (
    event.type === 'context.compaction.failed'
    && compactionAttemptId
    && nextActivity?.attemptId === compactionAttemptId
  ) {
    nextActivity = payload?.willRetry === true
      ? { ...nextActivity, status: 'retrying' }
      : null;
  } else if (
    event.type === 'context.compaction.completed'
    && compactionAttemptId
    && nextActivity?.attemptId === compactionAttemptId
  ) {
    nextActivity = null;
  }

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
        activity: nextActivity,
        contextUsage: event.type === 'context.usage.updated'
          ? (payload?.usage as ChatContextUsage | undefined) ?? current?.contextUsage ?? null
          : current?.contextUsage ?? null,
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
            : terminal
              ? materializeLiveMessage(
                (message ?? state.overlay.streamingMessage) as RawMessage | null,
              ) as RawMessage | null
              : message ?? state.overlay.streamingMessage,
        streamingMessages: startsNewRun || clearOverlay
          ? []
          : isPreparationProgress && message
            ? upsertPreparationProgressMessage(state.overlay.streamingMessages, message)
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
            ? appendStreamingToolResultSnapshot(state.overlay.streamingToolResults, message)
            : state.overlay.streamingToolResults,
        streamingTools: nextStreamingTools,
        toolEventCount: nextToolEventCount,
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
            retryAttempts: typeof payload?.retryAttempts === 'number' ? payload.retryAttempts : undefined,
          })
          : terminal
            ? null
            : state.error,
      updatedAt: event.occurredAt,
    },
  };
}
