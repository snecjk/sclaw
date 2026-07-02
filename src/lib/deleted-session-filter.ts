import { hostApiFetch } from '@/lib/host-api';
import { filterSuppressedExecutionRecords } from '../../shared/deleted-session-suppress';

const optimisticDeletedKeys = new Set<string>();

/** Keep freshly deleted keys hidden until the next successful deleted-keys fetch. */
export function rememberOptimisticDeletedSessionKey(sessionKey: string): void {
  const trimmed = sessionKey.trim();
  if (!trimmed) return;
  optimisticDeletedKeys.add(trimmed);
}

export function forgetOptimisticDeletedSessionKey(sessionKey: string): void {
  const trimmed = sessionKey.trim();
  if (!trimmed) return;
  optimisticDeletedKeys.delete(trimmed);
}

/** User-deleted execution record keys (strict; no revival on same-day re-run). */
export async function fetchDeletedSessionKeys(): Promise<Set<string>> {
  try {
    const res = await hostApiFetch<{ keys?: string[] }>('/api/sessions/deleted-keys');
    const keys = Array.isArray(res.keys) ? res.keys : [];
    return new Set([...keys, ...optimisticDeletedKeys]);
  } catch {
    return new Set(optimisticDeletedKeys);
  }
}

export function omitDeletedSessionKeys<T extends { key: string; updatedAt?: number }>(
  sessions: T[],
  deletedKeys: Set<string>,
): T[] {
  return filterSuppressedExecutionRecords(sessions, deletedKeys);
}
