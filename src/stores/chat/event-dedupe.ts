const CHAT_EVENT_DEDUPE_TTL_MS = 30_000;
const chatEventDedupe = new Map<string, number>();

export function isDuplicateChatEvent(eventState: string, event: Record<string, unknown>): boolean {
  const key = buildChatEventDedupeKey(eventState, event);
  if (!key) return false;
  const now = Date.now();
  for (const [candidate, timestamp] of chatEventDedupe.entries()) {
    if (now - timestamp > CHAT_EVENT_DEDUPE_TTL_MS) chatEventDedupe.delete(candidate);
  }
  if (chatEventDedupe.has(key)) return true;
  chatEventDedupe.set(key, now);
  return false;
}

function buildChatEventDedupeKey(eventState: string, event: Record<string, unknown>): string | null {
  const runId = event.runId != null ? String(event.runId) : '';
  const sessionKey = event.sessionKey != null ? String(event.sessionKey) : '';
  const sequence = event.seq != null ? String(event.seq) : '';
  const contentLength = eventState === 'delta' ? getContentLength(event.message) : '';
  if (runId || sessionKey || sequence || eventState) {
    return [runId, sessionKey, sequence, eventState, contentLength].join('|');
  }
  if (event.message && typeof event.message === 'object') {
    const message = event.message as Record<string, unknown>;
    const messageId = message.id != null ? String(message.id) : '';
    const stopReason = message.stopReason ?? message.stop_reason;
    if (messageId || stopReason) return `msg|${messageId}|${String(stopReason ?? '')}|${eventState}`;
  }
  return null;
}

function getContentLength(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const message = value as Record<string, unknown>;
  if (typeof message.content === 'string') return String(message.content.length);
  if (Array.isArray(message.content)) {
    return String(message.content.reduce((total, block) => {
      if (!block || typeof block !== 'object') return total;
      const part = block as Record<string, unknown>;
      return total + (typeof part.text === 'string' ? part.text.length : 0)
        + (typeof part.thinking === 'string' ? part.thinking.length : 0);
    }, 0));
  }
  return typeof message.text === 'string' ? String(message.text.length) : '';
}
