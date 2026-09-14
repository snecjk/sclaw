/**
 * Site App submit for normal users: pull (check/merge remote) then push.
 * Manual pull remains available for advanced users.
 */

import {
  getStoAppStatus,
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

/**
 * 用户只点「提交」时：先 pull 对齐远端，无冲突再 push。
 * 有冲突时停住，把冲突列表交回 UI。
 */
export async function submitStoAppWithAutoPull(
  workspaceId: string,
  message: string,
): Promise<StoAppSubmitOutcome> {
  let pulledAction: StoAppPullAction | undefined;

  try {
    const pullResult = await pullStoApp(workspaceId);
    const payload = readPullPayload(pullResult.json);
    pulledAction = payload.action;

    if (payload.action === 'conflicts') {
      const status = await getStoAppStatus(workspaceId).catch(() => null);
      const conflicts = payload.conflicts
        ?? status?.conflicts
        ?? [];
      return {
        kind: 'conflicts',
        status,
        conflicts,
        message: conflicts.length > 0
          ? `有 ${conflicts.length} 个文件需要处理，请先解决冲突再提交`
          : '有文件冲突需要处理，请先解决后再提交',
      };
    }

    const midStatus = await getStoAppStatus(workspaceId).catch(() => null);
    if (midStatus?.syncState === 'merge-required') {
      return {
        kind: 'conflicts',
        status: midStatus,
        conflicts: midStatus.conflicts ?? payload.conflicts ?? [],
        message: '还有未解决的冲突，请先处理后再提交',
      };
    }
  } catch (error) {
    const status = await getStoAppStatus(workspaceId).catch(() => null);
    return {
      kind: 'error',
      status,
      message: error instanceof Error ? error.message : '拉取远端失败，无法提交',
    };
  }

  try {
    await pushStoApp(workspaceId, message);
    const status = await getStoAppStatus(workspaceId).catch(() => null);
    return { kind: 'submitted', status, pulledAction };
  } catch (error) {
    const status = await getStoAppStatus(workspaceId).catch(() => null);
    if (isRemoteAheadError(error)) {
      return {
        kind: 'error',
        status,
        message: '远端又有新更新，请再点一次提交（会自动拉取）',
      };
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
