export interface HistoryPageSlice<T> {
  messages: T[];
  hasMore: boolean;
  totalCount: number;
}

export function sliceHistoryPage<T extends { id?: string }>(
  messages: readonly T[],
  options: { limit: number; beforeId?: string | null },
): HistoryPageSlice<T> {
  const totalCount = messages.length;
  const limit = Math.max(1, Math.floor(options.limit));
  let end = messages.length;
  if (options.beforeId) {
    const index = messages.findIndex((message) => message.id === options.beforeId);
    if (index <= 0) {
      return { messages: [], hasMore: false, totalCount };
    }
    end = index;
  }
  const start = Math.max(0, end - limit);
  return {
    messages: messages.slice(start, end) as T[],
    hasMore: start > 0,
    totalCount,
  };
}

export function mergeHistoryTail<T extends { id?: string; timestamp?: number }>(
  existing: readonly T[],
  incoming: readonly T[],
): T[] {
  if (incoming.length === 0) return [...existing];
  if (existing.length === 0) return [...incoming];

  const incomingIds = new Set(
    incoming.map((message) => message.id).filter((id): id is string => Boolean(id)),
  );
  const pivotId = incoming[0]?.id;
  const pivotIndex = pivotId
    ? existing.findIndex((message) => message.id === pivotId)
    : -1;
  if (pivotIndex >= 0) {
    return [...existing.slice(0, pivotIndex), ...incoming];
  }

  const kept = existing.filter((message) => !message.id || !incomingIds.has(message.id));
  const lastKept = kept[kept.length - 1];
  const firstIncomingTs = incoming[0]?.timestamp;
  const lastKeptTs = lastKept?.timestamp;
  if (
    typeof lastKeptTs === 'number'
    && typeof firstIncomingTs === 'number'
    && lastKeptTs <= firstIncomingTs
  ) {
    return [...kept, ...incoming];
  }
  return [...incoming];
}

export function prependHistoryPage<T extends { id?: string }>(
  existing: readonly T[],
  older: readonly T[],
): T[] {
  if (older.length === 0) return [...existing];
  const existingIds = new Set(
    existing.map((message) => message.id).filter((id): id is string => Boolean(id)),
  );
  const uniqueOlder = older.filter((message) => !message.id || !existingIds.has(message.id));
  return [...uniqueOlder, ...existing];
}

/** Keep the newest `limit` messages when leaving a session so renderer memory stays O(window). */
export function trimHistoryTail<T>(messages: readonly T[], limit: number): T[] {
  const size = Math.max(1, Math.floor(limit));
  if (messages.length <= size) return [...messages];
  return messages.slice(-size) as T[];
}

