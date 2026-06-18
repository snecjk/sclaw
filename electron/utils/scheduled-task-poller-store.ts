/**
 * Scheduled Task Poller Store
 *
 * Persists polling state (lastSyncTime, lastPolledAt per task, processedRunIds)
 * using electron-store. Supports offline compensation and duplicate prevention.
 */

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
 * Used to suppress virtual sessions (e.g. cron dated sessions generated from
 * run logs) from being re-created on next sessions list refresh.
 *
 * If `updatedAt` is provided and greater than the recorded deletion time,
 * the session is considered "revived" by newer activity — returns false.
 * This handles the case where a cron task is triggered on the same date
 * a previously-deleted dated session had: the new run has a newer timestamp,
 * so the dated session correctly reappears in the sidebar.
 */
export async function isSessionDeleted(sessionKey: string, updatedAt?: number): Promise<boolean> {
  const store = await getPollerStore();
  const keys = store.get('deletedSessions') as string[];
  if (!keys.includes(sessionKey)) return false;
  if (typeof updatedAt === 'number' && Number.isFinite(updatedAt) && updatedAt > 0) {
    const timestamps = store.get('deletedSessionTimestamps') as Record<string, number>;
    const deletedAt = timestamps[sessionKey];
    // No timestamp recorded for legacy entries: treat deletedAt as 0 (session stays hidden)
    if (typeof deletedAt !== 'number') return true;
    return deletedAt >= updatedAt;
  }
  return true;
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
