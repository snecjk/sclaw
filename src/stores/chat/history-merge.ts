import { toMs } from './helpers';
import type { RawMessage } from './types';

function messageDedupKey(message: RawMessage): string | null {
  if (message.id) return `id:${message.id}`;
  return null;
}

/** Union message lists by id (later sources win), then sort by timestamp. */
export function mergeHistoryMessageSources(sources: RawMessage[][]): RawMessage[] {
  const merged = new Map<string, RawMessage>();
  const withoutId: RawMessage[] = [];

  for (const source of sources) {
    for (const message of source) {
      const key = messageDedupKey(message);
      if (key) {
        merged.set(key, message);
      } else {
        withoutId.push(message);
      }
    }
  }

  return [...merged.values(), ...withoutId].sort(
    (a, b) => toMs(a.timestamp ?? 0) - toMs(b.timestamp ?? 0),
  );
}

/**
 * When Gateway history reload returns fewer messages than the UI already shows,
 * keep older in-memory turns that are missing from the reload. This prevents
 * task/cron sessions from losing their transcript when a follow-up send triggers
 * loadHistory while the original run is still in flight.
 */
export function mergeHistoryWhenShrunk(
  loaded: RawMessage[],
  current: RawMessage[],
): RawMessage[] {
  if (current.length === 0 || loaded.length >= current.length) {
    return loaded;
  }

  const loadedKeys = new Set(
    loaded.map(messageDedupKey).filter((key): key is string => key != null),
  );
  const extras = current.filter((message) => {
    const key = messageDedupKey(message);
    return key != null && !loadedKeys.has(key);
  });
  if (extras.length === 0) {
    return loaded;
  }

  return mergeHistoryMessageSources([extras, loaded]);
}
