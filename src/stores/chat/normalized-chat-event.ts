import { mapEventSessionKey } from './session-event-routing';

export interface NormalizedChatEvent {
  runId: string;
  eventState: string;
  resolvedState: string;
  eventSessionKey: string | null;
  resolvedSessionKey: string | null;
  message: unknown;
  phase: unknown;
  errorMessage: string;
}

export function normalizeChatEvent(input: {
  event: Record<string, unknown>;
  currentSessionKey: string;
}): NormalizedChatEvent {
  const { currentSessionKey, event } = input;
  const eventState = String(event.state || '');
  const eventSessionKey = event.sessionKey != null ? String(event.sessionKey) : null;

  return {
    runId: String(event.runId || ''),
    eventState,
    resolvedState: eventState || inferChatEventState(event),
    eventSessionKey,
    resolvedSessionKey: mapEventSessionKey({ eventSessionKey, currentSessionKey }),
    message: event.message,
    phase: event.phase,
    errorMessage: String(event.errorMessage || 'An error occurred'),
  };
}

function inferChatEventState(event: Record<string, unknown>): string {
  if (!event.message || typeof event.message !== 'object') {
    return '';
  }

  const msg = event.message as Record<string, unknown>;
  const stopReason = msg.stopReason ?? msg.stop_reason;
  if (stopReason) {
    return 'final';
  }
  if (msg.role || msg.content) {
    return 'delta';
  }
  return '';
}
