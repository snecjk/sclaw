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

export function buildChatSessionRuntimeView(
  session: ClientSessionState | undefined,
): ChatSessionRuntimeView {
  const runtime = session?.runtime ?? null;
  const sending = Boolean(runtime && ACTIVE_PHASES.has(runtime.phase));
  const lastUser = [...(session?.transcript ?? [])].reverse().find((message) => message.role === 'user');
  const userTimestamp = session?.overlay.optimisticUserMessage?.timestamp ?? lastUser?.timestamp;
  const lastUserMessageAt = sending && typeof userTimestamp === 'number' && Number.isFinite(userTimestamp)
    ? userTimestamp < 1_000_000_000_000 ? userTimestamp * 1_000 : userTimestamp
    : null;
  return {
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
}

export function useChatSessionRuntimeView(sessionKey: string): ChatSessionRuntimeView {
  const session = useChatRuntimeV2Store((state) => state.sessionsByKey[sessionKey]);
  return buildChatSessionRuntimeView(session);
}

export function useCurrentChatRuntimeView(): ChatSessionRuntimeView {
  const sessionKey = useChatStore((state) => state.currentSessionKey);
  return useChatSessionRuntimeView(sessionKey);
}
