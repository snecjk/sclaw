/**
 * Persists sidebar task-group first-trigger timestamps (ms) for stable group ordering.
 * Store file: task-group-first-trigger.json (electron-store).
 */

interface TaskGroupFirstTriggerSchema {
  taskGroupFirstTriggeredAt: Record<string, number>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let storeInstance: any = null;

async function getStore() {
  if (!storeInstance) {
    const Store = (await import('electron-store')).default;
    storeInstance = new Store<TaskGroupFirstTriggerSchema>({
      name: 'task-group-first-trigger',
      defaults: {
        taskGroupFirstTriggeredAt: {},
      },
    });
  }
  return storeInstance;
}

function normalizeGroupKey(groupKey: string): string {
  return groupKey.trim();
}

function normalizeAtMs(atMs?: number): number {
  const value = atMs ?? Date.now();
  return Number.isFinite(value) && value > 0 ? value : Date.now();
}

export async function listTaskGroupFirstTriggeredAt(): Promise<Record<string, number>> {
  const store = await getStore();
  const map = store.get('taskGroupFirstTriggeredAt') as Record<string, number>;
  return { ...map };
}

export async function getTaskGroupFirstTriggeredAt(groupKey: string): Promise<number | undefined> {
  const key = normalizeGroupKey(groupKey);
  if (!key) return undefined;
  const map = await listTaskGroupFirstTriggeredAt();
  const value = map[key];
  return typeof value === 'number' && value > 0 ? value : undefined;
}

/** Set first-trigger only when the group has no stored value yet. Returns effective timestamp. */
export async function markTaskGroupFirstTriggered(groupKey: string, atMs?: number): Promise<number> {
  const key = normalizeGroupKey(groupKey);
  if (!key) return normalizeAtMs(atMs);
  const store = await getStore();
  const map = { ...(store.get('taskGroupFirstTriggeredAt') as Record<string, number>) };
  const existing = map[key];
  if (typeof existing === 'number' && existing > 0) return existing;
  const next = normalizeAtMs(atMs);
  map[key] = next;
  store.set('taskGroupFirstTriggeredAt', map);
  return next;
}

/** Overwrite first-trigger (e.g. after all subitems deleted and user runs again). */
export async function resetTaskGroupFirstTriggered(groupKey: string, atMs?: number): Promise<number> {
  const key = normalizeGroupKey(groupKey);
  if (!key) return normalizeAtMs(atMs);
  const store = await getStore();
  const map = { ...(store.get('taskGroupFirstTriggeredAt') as Record<string, number>) };
  const next = normalizeAtMs(atMs);
  map[key] = next;
  store.set('taskGroupFirstTriggeredAt', map);
  return next;
}

/** Remove persisted first-trigger (when the last subitem in a group is deleted). */
export async function clearTaskGroupFirstTriggered(groupKey: string): Promise<void> {
  const key = normalizeGroupKey(groupKey);
  if (!key) return;
  const store = await getStore();
  const map = { ...(store.get('taskGroupFirstTriggeredAt') as Record<string, number>) };
  if (!(key in map)) return;
  delete map[key];
  store.set('taskGroupFirstTriggeredAt', map);
}

/**
 * On run: keep existing first-trigger; if absent (first run or 删光再跑), reset to now.
 */
export async function ensureTaskGroupFirstTriggeredOnRun(groupKey: string, atMs?: number): Promise<number> {
  const existing = await getTaskGroupFirstTriggeredAt(groupKey);
  if (typeof existing === 'number' && existing > 0) return existing;
  return resetTaskGroupFirstTriggered(groupKey, atMs);
}
