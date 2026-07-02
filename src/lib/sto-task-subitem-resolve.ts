import type { StoTaskId } from '@/lib/sto-tasks';
import { isStoTaskId } from '@/lib/sto-tasks';
import { stoTaskSubitemKey } from '@/stores/sto-task-subitems';

export interface StoTaskSubitemRef {
  taskId: StoTaskId;
  entryId: string;
  subitemKey: string;
}

/** 从 hidden 子项 sessionKey 反查 (taskId, entryId)。 */
export function resolveSubitemFromSessionKey(
  sessionKey: string,
  sessionKeyBySubitem: Record<string, string>,
): StoTaskSubitemRef | null {
  if (!sessionKey.trim()) return null;
  for (const [subitemKey, sk] of Object.entries(sessionKeyBySubitem)) {
    if (sk !== sessionKey) continue;
    const colon = subitemKey.indexOf(':');
    if (colon <= 0) continue;
    const taskIdRaw = subitemKey.slice(0, colon);
    const entryId = subitemKey.slice(colon + 1);
    if (!isStoTaskId(taskIdRaw) || !entryId) continue;
    return { taskId: taskIdRaw, entryId, subitemKey };
  }
  return null;
}

export function isSessionKeyForSubitem(
  sessionKey: string,
  taskId: StoTaskId,
  entryId: string,
  sessionKeyBySubitem: Record<string, string>,
): boolean {
  return sessionKeyBySubitem[stoTaskSubitemKey(taskId, entryId)] === sessionKey;
}
