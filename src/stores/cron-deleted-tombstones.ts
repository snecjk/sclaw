/** Hide recently deleted local cron jobs while Gateway list may still be stale (esp. on Windows). */
export const CRON_DELETED_TOMBSTONE_TTL_MS = 60_000;

export type CronJobEngineType = 'openclaw' | 'claude';

export interface CronDeletedTombstone {
  id: string;
  engineType: CronJobEngineType;
  deletedAt: number;
}

export function cronJobKey(engineType: CronJobEngineType, id: string): string {
  return `${engineType}:${id}`;
}

const tombstones = new Map<string, CronDeletedTombstone>();

export function rememberDeletedCronJob(id: string, engineType: CronJobEngineType, deletedAt = Date.now()): void {
  tombstones.set(cronJobKey(engineType, id), { id, engineType, deletedAt });
}

export function forgetDeletedCronJob(id: string, engineType: CronJobEngineType): void {
  tombstones.delete(cronJobKey(engineType, id));
}

export function pruneExpiredCronDeletedTombstones(now = Date.now()): void {
  for (const [key, entry] of tombstones) {
    if (now - entry.deletedAt > CRON_DELETED_TOMBSTONE_TTL_MS) {
      tombstones.delete(key);
    }
  }
}

export function isCronJobTombstoned(id: string, engineType: CronJobEngineType, now = Date.now()): boolean {
  const key = cronJobKey(engineType, id);
  const entry = tombstones.get(key);
  if (!entry) return false;
  if (now - entry.deletedAt > CRON_DELETED_TOMBSTONE_TTL_MS) {
    tombstones.delete(key);
    return false;
  }
  return true;
}

/**
 * Drop tombstoned jobs from a fresh Gateway list and clear tombstones once the
 * backend no longer returns the deleted id (deletion confirmed).
 */
export function applyCronDeletedTombstones<T extends { id: string; engineType: CronJobEngineType }>(
  jobs: T[],
  now = Date.now(),
): T[] {
  pruneExpiredCronDeletedTombstones(now);
  const fetchedKeys = new Set(jobs.map((job) => cronJobKey(job.engineType, job.id)));

  for (const key of [...tombstones.keys()]) {
    if (!fetchedKeys.has(key)) {
      tombstones.delete(key);
    }
  }

  return jobs.filter((job) => !isCronJobTombstoned(job.id, job.engineType, now));
}

/** Test-only helper */
export function resetCronDeletedTombstonesForTests(): void {
  tombstones.clear();
}
