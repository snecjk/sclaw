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
}

const MAX_PROCESSED_RUN_IDS = 1000;

async function getPollerStore() {
  if (!pollerStoreInstance) {
    const Store = (await import('electron-store')).default;
    pollerStoreInstance = new Store<PollerStoreSchema>({
      name: 'scheduled-task-poller',
      defaults: {
        lastPolledAt: {},
        processedRunIds: [],
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
