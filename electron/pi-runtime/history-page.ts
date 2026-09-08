import { sliceHistoryPage, type HistoryPageSlice } from '../../shared/chat-history-page';

type PiSessionEntryLike = {
  type?: unknown;
  id?: unknown;
  message?: unknown;
};

/** Project Pi's persisted branch entries into renderer messages with stable entry ids. */
export function projectPiHistoryMessages(entries: readonly unknown[]): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];
  for (const value of entries) {
    if (!value || typeof value !== 'object') continue;
    const entry = value as PiSessionEntryLike;
    if (entry.type !== 'message' || typeof entry.id !== 'string' || !entry.id) continue;
    if (!entry.message || typeof entry.message !== 'object') continue;
    messages.push({ ...(entry.message as Record<string, unknown>), id: entry.id });
  }
  return messages;
}

export function buildPiHistoryPage<T extends { id?: string }>(
  messages: readonly T[],
  options: { limit: number; beforeId?: string },
): HistoryPageSlice<T> {
  return sliceHistoryPage(messages, options);
}
