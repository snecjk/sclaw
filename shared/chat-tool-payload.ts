/** Bound overlay / live-cache tool payloads so a long run stays O(window). */
export const TOOL_PAYLOAD_MAX_CHARS = 4_096;
export const STREAMING_OVERLAY_BUFFER_LIMIT = 80;
export const LIVE_CLAUDE_MESSAGE_CAP = 200;
export const VISIBLE_TURN_TOOL_LIMIT = 10;

export function truncateToolPayload(value: unknown, maxChars = TOOL_PAYLOAD_MAX_CHARS): unknown {
  if (typeof value === 'string') {
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars)}…[truncated ${value.length - maxChars} chars]`;
  }
  if (Array.isArray(value)) {
    return value.map((item) => truncateToolPayload(item, maxChars));
  }
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    next[key] = truncateToolPayload(child, maxChars);
  }
  return next;
}

export function capWindow<T>(items: readonly T[], limit: number): T[] {
  const size = Math.max(1, Math.floor(limit));
  return items.length <= size ? [...items] : items.slice(-size) as T[];
}
