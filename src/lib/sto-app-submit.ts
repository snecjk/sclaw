/**
 * Site App submit for normal users.
 * - merge-required：按磁盘冲突标记对账；标记已清则自动继续合并再提交
 * - remote-ahead：先 pull 再 push
 * - 其它：直接 push（避免每次下载整包）；若远端又超前则 pull 一次再重试
 */

import {
  continueStoAppMerge,
  getStoAppStatus,
  listStoAppConflicts,
  pullStoApp,
  pushStoApp,
  type StoAppConflictFile,
  type StoAppPullAction,
  type StoAppStatus,
} from '@/lib/app-dev-api';
import { REMOTE_AHEAD_MESSAGE } from '../../shared/site-app-source-sync';

export type StoAppSubmitOutcome =
  | { kind: 'submitted'; status: StoAppStatus | null; pulledAction?: StoAppPullAction }
  | {
      kind: 'conflicts';
      status: StoAppStatus | null;
      conflicts: StoAppConflictFile[];
      message: string;
    }
  | { kind: 'error'; status: StoAppStatus | null; message: string };

function readPullPayload(json: unknown): {
  action?: StoAppPullAction;
  conflicts?: StoAppConflictFile[];
} {
  if (!json || typeof json !== 'object') return {};
  const row = json as { action?: StoAppPullAction; conflicts?: StoAppConflictFile[] };
  return {
    action: row.action,
    conflicts: Array.isArray(row.conflicts) ? row.conflicts : undefined,
  };
}

function isRemoteAheadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('REMOTE_AHEAD') || message.includes(REMOTE_AHEAD_MESSAGE);
}

async function finalizeMergeIfReady(workspaceId: string, status: StoAppStatus | null): Promise<{
  ok: true;
  status: StoAppStatus | null;
} | {
  ok: false;
  status: StoAppStatus | null;
  conflicts: StoAppConflictFile[];
  message: string;
}> {
  const listed = await listStoAppConflicts(workspaceId).catch(() => [] as StoAppConflictFile[]);
  const nextStatus = await getStoAppStatus(workspaceId).catch(() => status);
  const conflicts = listed.length > 0 ? listed : (nextStatus?.conflicts ?? []);
  if (conflicts.length > 0) {
    return {
      ok: false,
      status: nextStatus,
      conflicts,
      message: `还有 ${conflicts.length} 个文件带冲突标记，请先处理后再提交`,
    };
  }

  const revisionId = (
    nextStatus?.mergeTheirsRevisionId
    ?? nextStatus?.remoteRevisionId
    ?? nextStatus?.revisionId
    ?? ''
  ).trim();
  if (!revisionId) {
    return {
      ok: false,
      status: nextStatus,
      conflicts: [],
      message: '缺少冲突版本号，请先拉取远端更新',
    };
  }

  try {
    await continueStoAppMerge(workspaceId, revisionId);
    const after = await getStoAppStatus(workspaceId).catch(() => nextStatus);
    return { ok: true, status: after };
  } catch (error) {
    const after = await getStoAppStatus(workspaceId).catch(() => nextStatus);
    const remaining = after?.conflicts?.length
      ? after.conflicts
      : await listStoAppConflicts(workspaceId).catch(() => [] as StoAppConflictFile[]);
    return {
      ok: false,
      status: after,
      conflicts: remaining,
      message: error instanceof Error ? error.message : '确认合并失败，请先处理冲突',
    };
  }
}

async function pullForSubmit(workspaceId: string): Promise<StoAppSubmitOutcome | {
  kind: 'ready';
  pulledAction?: StoAppPullAction;
  status: StoAppStatus | null;
}> {
  try {
    const pullResult = await pullStoApp(workspaceId);
    const payload = readPullPayload(pullResult.json);

    if (payload.action === 'conflicts') {
      const status = await getStoAppStatus(workspaceId).catch(() => null);
      const conflicts = payload.conflicts ?? status?.conflicts ?? [];
      return {
        kind: 'conflicts',
        status,
        conflicts,
        message: conflicts.length > 0
          ? `有 ${conflicts.length} 个文件需要处理，请先解决冲突再提交`
          : '有文件冲突需要处理，请先解决后再提交',
      };
    }

    let status = await getStoAppStatus(workspaceId).catch(() => null);
    if (status?.syncState === 'merge-required') {
      const finalized = await finalizeMergeIfReady(workspaceId, status);
      if (!finalized.ok) {
        return {
          kind: 'conflicts',
          status: finalized.status,
          conflicts: finalized.conflicts,
          message: finalized.message,
        };
      }
      status = finalized.status;
      return { kind: 'ready', pulledAction: payload.action ?? 'merged', status };
    }

    return { kind: 'ready', pulledAction: payload.action, status };
  } catch (error) {
    const status = await getStoAppStatus(workspaceId).catch(() => null);
    return {
      kind: 'error',
      status,
      message: error instanceof Error ? error.message : '拉取远端失败，无法提交',
    };
  }
}

async function pushOnce(
  workspaceId: string,
  message: string,
  pulledAction?: StoAppPullAction,
): Promise<StoAppSubmitOutcome | { kind: 'remote-ahead'; status: StoAppStatus | null }> {
  try {
    await pushStoApp(workspaceId, message);
    const status = await getStoAppStatus(workspaceId).catch(() => null);
    return { kind: 'submitted', status, pulledAction };
  } catch (error) {
    const status = await getStoAppStatus(workspaceId).catch(() => null);
    if (isRemoteAheadError(error)) {
      return { kind: 'remote-ahead', status };
    }
    if (status?.syncState === 'merge-required') {
      return {
        kind: 'conflicts',
        status,
        conflicts: status.conflicts ?? [],
        message: error instanceof Error ? error.message : '还有未解决的冲突，无法提交',
      };
    }
    return {
      kind: 'error',
      status,
      message: error instanceof Error ? error.message : '提交失败',
    };
  }
}

/**
 * 用户只点「提交」时：
 * - 已在合并中 → 磁盘无冲突标记则自动继续合并并提交
 * - 远端超前 → pull 再 push
 * - 其它 → 直接 push（避免每次下载整包变慢）
 */
export async function submitStoAppWithAutoPull(
  workspaceId: string,
  message: string,
): Promise<StoAppSubmitOutcome> {
  let status = await getStoAppStatus(workspaceId).catch(() => null);

  if (status?.syncState === 'merge-required') {
    const finalized = await finalizeMergeIfReady(workspaceId, status);
    if (!finalized.ok) {
      return {
        kind: 'conflicts',
        status: finalized.status,
        conflicts: finalized.conflicts,
        message: finalized.message,
      };
    }
    const pushed = await pushOnce(workspaceId, message, 'merged');
    return pushed.kind === 'remote-ahead'
      ? {
          kind: 'error',
          status: pushed.status,
          message: '远端又有新更新，请再点一次提交（会自动拉取）',
        }
      : pushed;
  }

  if (status?.syncState === 'remote-ahead') {
    const pulled = await pullForSubmit(workspaceId);
    if (pulled.kind !== 'ready') return pulled;
    const pushed = await pushOnce(workspaceId, message, pulled.pulledAction);
    return pushed.kind === 'remote-ahead'
      ? {
          kind: 'error',
          status: pushed.status,
          message: '远端又有新更新，请再点一次提交（会自动拉取）',
        }
      : pushed;
  }

  const first = await pushOnce(workspaceId, message);
  if (first.kind !== 'remote-ahead') return first;

  const pulled = await pullForSubmit(workspaceId);
  if (pulled.kind !== 'ready') return pulled;
  const second = await pushOnce(workspaceId, message, pulled.pulledAction);
  return second.kind === 'remote-ahead'
    ? {
        kind: 'error',
        status: second.status,
        message: '远端又有新更新，请再点一次提交（会自动拉取）',
      }
    : second;
}
