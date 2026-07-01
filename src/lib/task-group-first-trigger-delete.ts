import i18n from '@/i18n';
import { toast } from 'sonner';
import { buildFirstTriggerPlaceholderSessionKey } from '../../shared/first-trigger-placeholder-session-key';
import { rememberOptimisticDeletedSessionKey } from '@/lib/deleted-session-filter';
import {
  clearTaskGroupFirstTriggered,
  forgetOptimisticTaskGroupFirstTriggered,
  getCachedTaskGroupFirstTriggeredMap,
  rememberOptimisticTaskGroupFirstTriggered,
  rememberOptimisticTaskGroupFirstTriggeredClear,
  restoreTaskGroupFirstTriggered,
} from '@/lib/task-group-first-trigger';

export type LastSessionDeleteFirstTriggerPrep = {
  groupKey: string;
  /** Value to restore when delete fails after a successful clear. */
  restoreAtMs?: number;
};

function resolveRestoreAtMs(groupKey: string, fallbackAtMs?: number): number | undefined {
  const cached = getCachedTaskGroupFirstTriggeredMap()[groupKey];
  if (typeof cached === 'number' && cached > 0) return cached;
  if (typeof fallbackAtMs === 'number' && fallbackAtMs > 0) return fallbackAtMs;
  return undefined;
}

function revertOptimisticFirstTriggerClear(prep: LastSessionDeleteFirstTriggerPrep): void {
  forgetOptimisticTaskGroupFirstTriggered(prep.groupKey);
  if (prep.restoreAtMs != null && prep.restoreAtMs > 0) {
    rememberOptimisticTaskGroupFirstTriggered(prep.groupKey, prep.restoreAtMs);
  }
}

export function notifyTaskGroupFirstTriggerClearFailed(): void {
  toast.error(i18n.t('common:sidebar.deleteSessionFailed'), {
    description: i18n.t('common:sidebar.deleteSessionFailedHint'),
  });
}

/**
 * Clear persisted first-trigger before deleting the last session in a group.
 * Must complete before deleteSession — loadSessions reads server first-trigger map.
 */
export async function prepareFirstTriggerClearBeforeLastSessionDelete(
  groupKey: string,
  options?: { fallbackAtMs?: number },
): Promise<LastSessionDeleteFirstTriggerPrep | null> {
  const trimmed = groupKey.trim();
  if (!trimmed) return null;

  const restoreAtMs = resolveRestoreAtMs(trimmed, options?.fallbackAtMs);
  const prep: LastSessionDeleteFirstTriggerPrep = { groupKey: trimmed, restoreAtMs };

  rememberOptimisticTaskGroupFirstTriggeredClear(trimmed);
  const cleared = await clearTaskGroupFirstTriggered(trimmed);
  if (!cleared) {
    revertOptimisticFirstTriggerClear(prep);
    notifyTaskGroupFirstTriggerClearFailed();
    return null;
  }

  return prep;
}

/** Roll back optimistic + persisted first-trigger when deleteSession fails after clear. */
export async function revertFirstTriggerClearAfterFailedDelete(
  prep: LastSessionDeleteFirstTriggerPrep,
): Promise<void> {
  revertOptimisticFirstTriggerClear(prep);
  if (prep.restoreAtMs != null && prep.restoreAtMs > 0) {
    await restoreTaskGroupFirstTriggered(prep.groupKey, prep.restoreAtMs);
  }
}

/**
 * Keys that virtual session generators may resurrect after deleting the last subitem.
 * The first-trigger placeholder often uses a different date than the visible session.
 */
export function collectAdditionalSuppressKeysForLastGroupSessionDelete(
  groupKey: string,
  sessions: Array<{ key: string }>,
  deletingKey: string,
  firstTriggeredAtMs?: number,
): string[] {
  const out = new Set<string>();
  for (const session of sessions) {
    if (session.key !== deletingKey) out.add(session.key);
  }
  const placeholderKey = buildFirstTriggerPlaceholderSessionKey(groupKey, firstTriggeredAtMs ?? 0);
  if (placeholderKey && placeholderKey !== deletingKey) out.add(placeholderKey);
  return [...out];
}

/** Renderer-side hide for placeholder / sibling keys before deleteSession refresh. */
export function rememberSuppressedKeysForLastGroupSessionDelete(
  groupKey: string,
  sessions: Array<{ key: string }>,
  deletingKey: string,
  firstTriggeredAtMs?: number,
): string[] {
  const keys = collectAdditionalSuppressKeysForLastGroupSessionDelete(
    groupKey,
    sessions,
    deletingKey,
    firstTriggeredAtMs,
  );
  for (const key of keys) rememberOptimisticDeletedSessionKey(key);
  return keys;
}
