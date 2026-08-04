import { useChatStore } from './store';
import { useChatRuntimeV2Store } from './runtime-v2-store';
import type { ClientRunState, ClientSessionState } from './client-session-reducer';
import type { RawMessage, ToolStatus } from './types';

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
  pendingFinal: boolean;
  error: string | null;
  phase: ClientRunState['phase'] | null;
  lastEventAt: number;
  lastUserMessageAt: number | null;
  streamingMessage: RawMessage | null;
  streamingMessages: RawMessage[];
  streamingToolResults: RawMessage[];
  streamingTools: ToolStatus[];
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
    return `${sessionKey}\u0000${sending ? '1' : '0'}\u0000${sending ? runtime?.runId ?? '' : ''}\u0000${session.error?.message ?? ''}`;
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
  error: null,
  phase: null,
  lastEventAt: 0,
  lastUserMessageAt: null,
  streamingMessage: null,
  streamingMessages: [],
  streamingToolResults: [],
  streamingTools: [],
};
const runtimeViewCache = new WeakMap<ClientSessionState, ChatSessionRuntimeView>();

export function buildChatSessionRuntimeView(
  session: ClientSessionState | undefined,
): ChatSessionRuntimeView {
  if (!session) return EMPTY_RUNTIME_VIEW;
  const runtime = session?.runtime ?? null;
  const sending = Boolean(runtime && ACTIVE_PHASES.has(runtime.phase));
  const lastUser = [...(session?.transcript ?? [])].reverse().find((message) => message.role === 'user');
  const userTimestamp = session?.overlay.optimisticUserMessage?.timestamp ?? lastUser?.timestamp;
  const lastUserMessageAt = sending && typeof userTimestamp === 'number' && Number.isFinite(userTimestamp)
    ? userTimestamp < 1_000_000_000_000 ? userTimestamp * 1_000 : userTimestamp
    : null;
  const view: ChatSessionRuntimeView = {
    sending,
    activeRunId: sending ? runtime?.runId ?? null : null,
    pendingFinal: Boolean(session?.overlay.awaitingTranscript),
    error: session?.error?.message ?? null,
    phase: runtime?.phase ?? null,
    lastEventAt: runtime?.lastEventAt ?? 0,
    lastUserMessageAt,
    streamingMessage: session?.overlay.streamingMessage ?? null,
    streamingMessages: session?.overlay.streamingMessages ?? [],
    streamingToolResults: session?.overlay.streamingToolResults ?? [],
    streamingTools: session?.overlay.streamingTools ?? [],
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

export function useCurrentChatRuntimeView(): ChatSessionRuntimeView {
  const sessionKey = useChatStore((state) => state.currentSessionKey);
  return useChatSessionRuntimeView(sessionKey);
}
