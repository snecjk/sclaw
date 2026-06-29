/**
 * Scheduled Task Poller Store
 *
 * Persists polling state (lastSyncTime, lastPolledAt per task, processedRunIds)
 * using electron-store. Supports offline compensation and duplicate prevention.
 */

import { filterSuppressedExecutionRecords } from '../../shared/deleted-session-suppress';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pollerStoreInstance: any = null;

interface PollerStoreSchema {
  lastSyncTime?: string;
  lastPolledAt: Record<string, string>;
  processedRunIds: string[];
  deletedSessions: string[];
  deletedSessionTimestamps: Record<string, number>;
}

const MAX_PROCESSED_RUN_IDS = 1000;
const MAX_DELETED_SESSIONS = 5000;

async function getPollerStore() {
  if (!pollerStoreInstance) {
    const Store = (await import('electron-store')).default;
    pollerStoreInstance = new Store<PollerStoreSchema>({
      name: 'scheduled-task-poller',
      defaults: {
        lastPolledAt: {},
        processedRunIds: [],
        deletedSessions: [],
        deletedSessionTimestamps: {},
      },
    });
  }
  return pollerStoreInstance;
}

export async function getLastSyncTime(): Promise<string | undefined> {
  const store = await getPollerStore();
  return store.get('lastSyncTime') as string | undefined;
}

export async function setLastSyncTime(time: string): Promise<void> {
  const store = await getPollerStore();
  store.set('lastSyncTime', time);
}

export async function getLastPolledAt(taskId: number): Promise<string | undefined> {
  const store = await getPollerStore();
  return (store.get('lastPolledAt') as Record<string, string>)[String(taskId)];
}

export async function setLastPolledAt(taskId: number, time: string): Promise<void> {
  const store = await getPollerStore();
  const current = store.get('lastPolledAt') as Record<string, string>;
  store.set('lastPolledAt', { ...current, [String(taskId)]: time });
}

export async function isRunProcessed(runId: number | string): Promise<boolean> {
  const store = await getPollerStore();
  const ids = store.get('processedRunIds') as string[];
  return ids.includes(String(runId));
}

export async function markRunProcessed(runId: number | string): Promise<void> {
  const store = await getPollerStore();
  const ids = store.get('processedRunIds') as string[];
  const next = [...ids, String(runId)];
  if (next.length > MAX_PROCESSED_RUN_IDS) {
    next.splice(0, next.length - MAX_PROCESSED_RUN_IDS);
  }
  store.set('processedRunIds', next);
}

/**
 * Check whether a session key has been explicitly deleted by the user.
 * Deletion is strict: once marked, the execution record stays hidden even if
 * the same task runs again on the same calendar day (no "revival" by updatedAt).
 */
export async function isSessionDeleted(sessionKey: string): Promise<boolean> {
  const store = await getPollerStore();
  const keys = store.get('deletedSessions') as string[];
  return keys.includes(sessionKey);
}

export async function listDeletedSessionKeys(): Promise<string[]> {
  const store = await getPollerStore();
  return store.get('deletedSessions') as string[];
}

export async function filterDeletedSessions<T extends { key: string; updatedAt?: number }>(
  sessions: T[],
): Promise<T[]> {
  if (sessions.length === 0) return sessions;
  const deleted = new Set(await listDeletedSessionKeys());
  if (deleted.size === 0) return sessions;
  return filterSuppressedExecutionRecords(sessions, deleted);
}

/**
 * Mark a session key as deleted so that virtual session generators can skip it.
 */
export async function markSessionDeleted(sessionKey: string): Promise<void> {
  const store = await getPollerStore();
  const keys = store.get('deletedSessions') as string[];
  if (!keys.includes(sessionKey)) {
    const next = [...keys, sessionKey];
    if (next.length > MAX_DELETED_SESSIONS) {
      next.splice(0, next.length - MAX_DELETED_SESSIONS);
    }
    store.set('deletedSessions', next);
  }
  const timestamps = store.get('deletedSessionTimestamps') as Record<string, number>;
  store.set('deletedSessionTimestamps', { ...timestamps, [sessionKey]: Date.now() });
}

/**
 * Remove a deleted-session marker (e.g. when user explicitly revives a session
 * or when the underlying data source is permanently removed).
 */
export async function unmarkSessionDeleted(sessionKey: string): Promise<void> {
  const store = await getPollerStore();
  const keys = store.get('deletedSessions') as string[];
  if (keys.includes(sessionKey)) {
    store.set('deletedSessions', keys.filter((k) => k !== sessionKey));
  }
  const timestamps = store.get('deletedSessionTimestamps') as Record<string, number>;
  if (sessionKey in timestamps) {
    const next = { ...timestamps };
    delete next[sessionKey];
    store.set('deletedSessionTimestamps', next);
  }
}
