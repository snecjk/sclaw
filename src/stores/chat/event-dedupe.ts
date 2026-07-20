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
  const phase = event.phase != null ? String(event.phase) : '';
  const messageFingerprint = getMessageFingerprint(event.message);
  if (runId || sessionKey || sequence || eventState) {
    return [runId, sessionKey, sequence, eventState, phase, messageFingerprint].join('|');
  }
  if (event.message && typeof event.message === 'object') {
    const message = event.message as Record<string, unknown>;
    const messageId = message.id != null ? String(message.id) : '';
    const stopReason = message.stopReason ?? message.stop_reason;
    if (messageId || stopReason) return `msg|${messageId}|${String(stopReason ?? '')}|${eventState}`;
  }
  return null;
}

function getMessageFingerprint(value: unknown): string {
  if (value == null) return '';
  let serialized: string;
  try {
    serialized = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    serialized = String(value);
  }
  // FNV-1a keeps dedupe keys bounded while distinguishing equal-length deltas.
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${serialized.length}:${(hash >>> 0).toString(16)}`;
}
