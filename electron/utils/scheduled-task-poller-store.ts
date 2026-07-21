/**
 * Scheduled Task Poller Store
 *
 * Now serves only the shared deleted-session tombstone ledger used by cron /
 * claude scheduled-task virtual-session generators. Cloud poller state
 * (lastSyncTime / lastPolledAt / processedRunIds) has been removed alongside
 * the cloud `/agent/v1/scheduled-tasks` chain.
 */

import { filterSuppressedExecutionRecords } from '../../shared/deleted-session-suppress';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pollerStoreInstance: any = null;

interface PollerStoreSchema {
  deletedSessions: string[];
  deletedSessionTimestamps: Record<string, number>;
}

const MAX_DELETED_SESSIONS = 5000;

async function getPollerStore() {
  if (!pollerStoreInstance) {
    const Store = (await import('electron-store')).default;
    pollerStoreInstance = new Store<PollerStoreSchema>({
      name: 'scheduled-task-poller',
      defaults: {
        deletedSessions: [],
        deletedSessionTimestamps: {},
      },
    });
  }
  return pollerStoreInstance;
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
