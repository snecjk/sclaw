const GATEWAY_EVENT_DEDUPE_TTL_MS = 30_000;

function summarizeGatewayMessageContent(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === 'string') return content.trim().slice(0, 120);
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (!block || typeof block !== 'object') return '';
        const part = block as Record<string, unknown>;
        if (typeof part.text === 'string') return part.text;
        if (typeof part.thinking === 'string') return part.thinking;
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim()
      .slice(0, 120);
  }
  if (typeof message.text === 'string') return message.text.trim().slice(0, 120);
  return '';
}

function getGatewayMessageContentLength(message: Record<string, unknown>): number {
  const content = message.content;
  if (typeof content === 'string') return content.length;
  if (Array.isArray(content)) {
    let total = 0;
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const part = block as Record<string, unknown>;
      if (typeof part.text === 'string') total += part.text.length;
      else if (typeof part.thinking === 'string') total += part.thinking.length;
    }
    return total;
  }
  if (typeof message.text === 'string') return message.text.length;
  return 0;
}

export function buildGatewayEventDedupeKey(event: Record<string, unknown>): string | null {
  const runId = event.runId != null ? String(event.runId) : '';
  const sessionKey = event.sessionKey != null ? String(event.sessionKey) : '';
  const seq = event.seq != null ? String(event.seq) : '';
  const state = event.state != null ? String(event.state) : '';
  const message = event.message;
  if (message && typeof message === 'object') {
    const msg = message as Record<string, unknown>;
    const messageId = msg.id != null ? String(msg.id) : '';
    const stopReason = msg.stopReason ?? msg.stop_reason;
    const role = msg.role != null ? String(msg.role) : '';
    const summary = summarizeGatewayMessageContent(msg);
    const contentLen = getGatewayMessageContentLength(msg);
    if (messageId || stopReason || summary) {
      return [
        'msg',
        runId,
        state,
        messageId,
        String(stopReason ?? ''),
        role,
        summary,
        String(contentLen),
      ].join('|');
    }
  }
  if (runId || sessionKey || seq || state) {
    return [runId, sessionKey, seq, state].join('|');
  }
  return null;
}

export function createGatewayEventDeduper(ttlMs = GATEWAY_EVENT_DEDUPE_TTL_MS): {
  shouldProcess: (event: Record<string, unknown>, now?: number) => boolean;
} {
  const seen = new Map<string, number>();

  const prune = (now: number) => {
    for (const [key, ts] of seen) {
      if (now - ts > ttlMs) {
        seen.delete(key);
      }
    }
  };

  return {
    shouldProcess(event, now = Date.now()) {
      const key = buildGatewayEventDedupeKey(event);
      if (!key) return true;
      prune(now);
      if (seen.has(key)) return false;
      seen.set(key, now);
      return true;
    },
  };
}

