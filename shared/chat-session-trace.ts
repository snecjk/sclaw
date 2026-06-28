/**
 * Structured diagnostics for chat session message merge / dedupe.
 * Filter DevTools console by `[chat-session]` when investigating duplicate or missing user turns.
 */

export type ChatSessionTracePhase =
  | 'merge-optimistic'
  | 'dedupe-user'
  | 'load-history';

export interface ChatSessionTraceEvent {
  phase: ChatSessionTracePhase;
  action: string;
  sessionKey?: string;
  userMessageAt?: number | null;
  sending?: boolean;
  messageCountBefore?: number;
  messageCountAfter?: number;
  optimisticId?: string;
  matchedHistoryUserId?: string;
  droppedMessageIds?: string[];
  reason?: string;
  detail?: Record<string, unknown>;
}

const MAX_TEXT_SNIPPET = 80;

export function truncateChatSessionText(text: string, maxLen = MAX_TEXT_SNIPPET): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen)}…`;
}

export function formatChatSessionTraceLine(event: ChatSessionTraceEvent): string {
  const parts = [
    `[chat-session] phase=${event.phase}`,
    `action=${event.action}`,
  ];
  if (event.sessionKey) parts.push(`session=${event.sessionKey}`);
  if (event.reason) parts.push(`reason=${event.reason}`);
  if (event.messageCountBefore != null && event.messageCountAfter != null) {
    parts.push(`messages=${event.messageCountBefore}->${event.messageCountAfter}`);
  }
  if (event.optimisticId) parts.push(`optimisticId=${event.optimisticId}`);
  if (event.matchedHistoryUserId) parts.push(`historyUserId=${event.matchedHistoryUserId}`);
  if (event.droppedMessageIds?.length) {
    parts.push(`dropped=${event.droppedMessageIds.join(',')}`);
  }
  return parts.join(' ');
}

export function traceChatSession(event: ChatSessionTraceEvent): void {
  const line = formatChatSessionTraceLine(event);
  const payload = {
    ...event.detail,
    userMessageAt: event.userMessageAt,
    sending: event.sending,
  };
  if (event.action.startsWith('skip') || event.action.startsWith('drop') || event.action.includes('duplicate')) {
    console.warn(line, payload);
  } else {
    console.info(line, payload);
  }
}
