import { hostApiFetch } from '@/lib/host-api';

type FirstTriggerAction = 'mark' | 'reset' | 'clear';

let cachedMap: Record<string, number> = {};
/** undefined = optimistically cleared; number = optimistic value */
const optimisticMap = new Map<string, number | undefined>();

export function getCachedTaskGroupFirstTriggeredMap(): Record<string, number> {
  const merged = { ...cachedMap };
  for (const [key, value] of optimisticMap.entries()) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}

export async function fetchTaskGroupFirstTriggeredMap(): Promise<Record<string, number>> {
  try {
    const res = await hostApiFetch<{ map?: Record<string, number> }>('/api/task-groups/first-triggered-at');
    cachedMap = res.map && typeof res.map === 'object' ? { ...res.map } : {};
  } catch {
    // keep last cached map
  }
  return getCachedTaskGroupFirstTriggeredMap();
}

function rememberOptimistic(groupKey: string, value: number | undefined): void {
  const trimmed = groupKey.trim();
  if (!trimmed) return;
  optimisticMap.set(trimmed, value);
}

export function forgetOptimisticTaskGroupFirstTriggered(groupKey: string): void {
  const trimmed = groupKey.trim();
  if (!trimmed) return;
  optimisticMap.delete(trimmed);
}

type PostTaskGroupFirstTriggeredResult =
  | { ok: true; triggeredAtMs?: number }
  | { ok: false };

async function postTaskGroupFirstTriggered(
  groupKey: string,
  action: FirstTriggerAction,
  triggeredAtMs?: number,
): Promise<PostTaskGroupFirstTriggeredResult> {
  const trimmed = groupKey.trim();
  if (!trimmed) return { ok: false };
  try {
    const res = await hostApiFetch<{
      success?: boolean;
      triggeredAtMs?: number;
      cleared?: boolean;
    }>('/api/task-groups/first-triggered-at', {
      method: 'POST',
      body: JSON.stringify({ groupKey: trimmed, action, triggeredAtMs }),
    });
    if (res.success === false) return { ok: false };
    if (action === 'clear') {
      rememberOptimistic(trimmed, undefined);
      delete cachedMap[trimmed];
      return { ok: true };
    }
    const at = typeof res.triggeredAtMs === 'number' ? res.triggeredAtMs : triggeredAtMs ?? Date.now();
    cachedMap[trimmed] = at;
    rememberOptimistic(trimmed, at);
    return { ok: true, triggeredAtMs: at };
  } catch {
    return { ok: false };
  }
}

/** Set only when absent (legacy mark). */
export async function markTaskGroupFirstTriggered(groupKey: string, triggeredAtMs?: number): Promise<void> {
  await postTaskGroupFirstTriggered(groupKey, 'mark', triggeredAtMs);
}

/** Overwrite first-trigger (删光再跑 / fresh group run). */
export async function resetTaskGroupFirstTriggered(groupKey: string, triggeredAtMs?: number): Promise<void> {
  await postTaskGroupFirstTriggered(groupKey, 'reset', triggeredAtMs);
}

export async function clearTaskGroupFirstTriggered(groupKey: string): Promise<boolean> {
  const result = await postTaskGroupFirstTriggered(groupKey, 'clear');
  return result.ok;
}

/** Restore first-trigger after a failed last-session delete rollback. */
export async function restoreTaskGroupFirstTriggered(
  groupKey: string,
  triggeredAtMs: number,
): Promise<boolean> {
  if (!(triggeredAtMs > 0)) return false;
  const result = await postTaskGroupFirstTriggered(groupKey, 'reset', triggeredAtMs);
  return result.ok;
}

/**
 * On manual/auto run: reset when group has no stored first-trigger (first run or 删光再跑),
 * otherwise leave existing first-trigger unchanged.
 */
export async function ensureTaskGroupFirstTriggeredOnRun(groupKey: string, triggeredAtMs?: number): Promise<void> {
  const trimmed = groupKey.trim();
  if (!trimmed) return;
  const at = triggeredAtMs ?? Date.now();
  const effective = getCachedTaskGroupFirstTriggeredMap()[trimmed];
  if (typeof effective === 'number' && effective > 0) {
    return;
  }
  rememberOptimistic(trimmed, at);
  await postTaskGroupFirstTriggered(trimmed, 'reset', at);
}

export function rememberOptimisticTaskGroupFirstTriggered(groupKey: string, triggeredAtMs: number): void {
  rememberOptimistic(groupKey, triggeredAtMs);
}

export function rememberOptimisticTaskGroupFirstTriggeredClear(groupKey: string): void {
  rememberOptimistic(groupKey, undefined);
}

/** True after optimistic clear until a new first-trigger value is written. */
export function isTaskGroupFirstTriggerOptimisticallyCleared(groupKey: string): boolean {
  const trimmed = groupKey.trim();
  if (!trimmed) return false;
  return optimisticMap.has(trimmed) && optimisticMap.get(trimmed) === undefined;
}

/**
 * Lock group first-trigger before partial subitem delete or lazy backfill for legacy groups.
 * No-op when the group already has a persisted/optimistic timestamp.
 */
export async function seedTaskGroupFirstTriggeredIfAbsent(
  groupKey: string,
  triggeredAtMs: number,
): Promise<boolean> {
  const trimmed = groupKey.trim();
  if (!trimmed || !(triggeredAtMs > 0)) return false;
  const effective = getCachedTaskGroupFirstTriggeredMap()[trimmed];
  if (typeof effective === 'number' && effective > 0) return false;
  rememberOptimistic(trimmed, triggeredAtMs);
  const result = await postTaskGroupFirstTriggered(trimmed, 'mark', triggeredAtMs);
  return result.ok;
}
