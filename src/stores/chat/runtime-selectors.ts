import { useChatStore } from './store';
import { useChatRuntimeV2Store } from './runtime-v2-store';
import type { ClientRunState, ClientSessionState } from './client-session-reducer';
import type { RawMessage, ToolStatus } from './types';
import { formatChatRuntimeErrorForDisplay } from './runtime-error-message';

const ACTIVE_PHASES = new Set<ClientRunState['phase']>([
  'dispatching',
  'uncertain',
  'running',
  'awaiting_transcript',
  'aborting',
  'reconciling',
]);

export interface ChatSessionRuntimeView {
  sending: boolean;
  activeRunId: string | null;
  /** The live response is finalizing while the run is still active. */
  pendingFinal: boolean;
  /** Final overlay is retained until authoritative transcript history takes over. */
  transcriptPending: boolean;
  error: string | null;
  phase: ClientRunState['phase'] | null;
  lastEventAt: number;
  /** User timestamp exposed only while the run is active. */
  lastUserMessageAt: number | null;
  /** User timestamp retained solely to anchor a completed final overlay. */
  turnAnchorAt: number | null;
  streamingMessage: RawMessage | null;
  streamingMessages: RawMessage[];
  streamingToolResults: RawMessage[];
  streamingTools: ToolStatus[];
  toolEventCount: number;
}

export interface ChatRuntimeIndicator {
  sending: boolean;
  activeRunId: string | null;
  error: string | null;
}

let indicatorRevision = '';
let indicatorCache: Record<string, ChatRuntimeIndicator> = {};

function selectRuntimeIndicators(state: { sessionsByKey: Record<string, ClientSessionState> }) {
  const entries = Object.entries(state.sessionsByKey).sort(([left], [right]) => left.localeCompare(right));
  const revision = entries.map(([sessionKey, session]) => {
    const runtime = session.runtime;
    const sending = Boolean(runtime && ACTIVE_PHASES.has(runtime.phase));
    return `${sessionKey}\u0000${sending ? '1' : '0'}\u0000${sending ? runtime?.runId ?? '' : ''}\u0000${session.error ? formatChatRuntimeErrorForDisplay(session.error) : ''}`;
  }).join('\u0001');
  if (revision === indicatorRevision) return indicatorCache;
  indicatorRevision = revision;
  indicatorCache = Object.fromEntries(entries.map(([sessionKey, session]) => {
    const runtime = buildChatSessionRuntimeView(session);
    return [sessionKey, {
      sending: runtime.sending,
      activeRunId: runtime.activeRunId,
      error: runtime.error,
    }];
  }));
  return indicatorCache;
}

export function useChatRuntimeIndicators(): Record<string, ChatRuntimeIndicator> {
  return useChatRuntimeV2Store(selectRuntimeIndicators);
}

const EMPTY_RUNTIME_VIEW: ChatSessionRuntimeView = {
  sending: false,
  activeRunId: null,
  pendingFinal: false,
  transcriptPending: false,
  error: null,
  phase: null,
  lastEventAt: 0,
  lastUserMessageAt: null,
  turnAnchorAt: null,
  streamingMessage: null,
  streamingMessages: [],
  streamingToolResults: [],
  streamingTools: [],
  toolEventCount: 0,
};
const runtimeViewCache = new WeakMap<ClientSessionState, ChatSessionRuntimeView>();

export function buildChatSessionRuntimeView(
  session: ClientSessionState | undefined,
): ChatSessionRuntimeView {
  if (!session) return EMPTY_RUNTIME_VIEW;
  const runtime = session?.runtime ?? null;
  const sending = Boolean(runtime && ACTIVE_PHASES.has(runtime.phase));
  const transcriptPending = Boolean(session?.overlay.awaitingTranscript);
  const pendingFinal = sending && transcriptPending;
  const lastUser = [...(session?.transcript ?? [])].reverse().find((message) => message.role === 'user');
  const optimisticTimestamp = session?.overlay.optimisticUserMessage?.timestamp;
  const transcriptTimestamp = lastUser?.timestamp;
  const toMilliseconds = (value: number | undefined): number | null => (
    typeof value === 'number' && Number.isFinite(value)
      ? value < 1_000_000_000_000 ? value * 1_000 : value
      : null
  );
  const optimisticAt = toMilliseconds(optimisticTimestamp);
  const transcriptAt = toMilliseconds(transcriptTimestamp);
  // A background run may become active before its user turn reaches history.
  // Do not attach that run's activity to the previous transcript turn.
  const currentTranscriptAt = runtime && transcriptAt !== null && transcriptAt >= runtime.startedAt - 2_000
    ? transcriptAt
    : null;
  const currentUserMessageAt = optimisticAt ?? currentTranscriptAt;
  // A terminal run can still be waiting for its authoritative transcript.
  // Keep a display-only anchor until history takes over without exposing that
  // retained overlay as an active response to lifecycle/meta consumers.
  const lastUserMessageAt = sending ? currentUserMessageAt : null;
  const turnAnchorAt = sending || transcriptPending
    ? currentUserMessageAt
    : null;
  const view: ChatSessionRuntimeView = {
    sending,
    activeRunId: sending ? runtime?.runId ?? null : null,
    pendingFinal,
    transcriptPending,
    error: session?.error ? formatChatRuntimeErrorForDisplay(session.error) : null,
    phase: runtime?.phase ?? null,
    lastEventAt: runtime?.lastEventAt ?? 0,
    lastUserMessageAt,
    turnAnchorAt,
    streamingMessage: session?.overlay.streamingMessage ?? null,
    streamingMessages: session?.overlay.streamingMessages ?? [],
    streamingToolResults: session?.overlay.streamingToolResults ?? [],
    streamingTools: session?.overlay.streamingTools ?? [],
    toolEventCount: session?.overlay.toolEventCount ?? 0,
  };
  return view;
}

function getCachedRuntimeView(session: ClientSessionState | undefined): ChatSessionRuntimeView {
  if (!session) return EMPTY_RUNTIME_VIEW;
  const cached = runtimeViewCache.get(session);
  if (cached) return cached;
  const view = buildChatSessionRuntimeView(session);
  runtimeViewCache.set(session, view);
  return view;
}

export function useChatSessionRuntimeView(sessionKey: string): ChatSessionRuntimeView {
  const session = useChatRuntimeV2Store((state) => state.sessionsByKey[sessionKey]);
  return getCachedRuntimeView(session);
}

/** Sending flag only — does not re-render on streaming deltas. */
export function useChatSessionSending(sessionKey: string): boolean {
  return useChatRuntimeV2Store((state) => {
    const runtime = state.sessionsByKey[sessionKey]?.runtime;
    return Boolean(runtime && ACTIVE_PHASES.has(runtime.phase));
  });
}

export function useCurrentChatRuntimeView(): ChatSessionRuntimeView {
  const sessionKey = useChatStore((state) => state.currentSessionKey);
  return useChatSessionRuntimeView(sessionKey);
}
