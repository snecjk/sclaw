import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../utils/logger';
import { getStoClawHomeDir } from '../utils/paths';
import { ScheduleTaskRepository } from '../db/repositories/schedule-task-repository';

const MARKER_FILENAME = 'schedule-tasks-ownership-claim.done';

export interface OwnershipClaimMarker {
  claimedBy: string;
  count: number;
  completedAt: string;
}

export function getOwnershipClaimMarkerPath(): string {
  return join(getStoClawHomeDir(), MARKER_FILENAME);
}

function readMarker(path: string): OwnershipClaimMarker | null {
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as OwnershipClaimMarker;
    if (!parsed || typeof parsed.claimedBy !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 已认证后归属认领：只补 `created_by IS NULL`。有 marker 则跳过认领（切号不重认领）。
 * Marker 丢失再跑仍只补 NULL。
 */
export async function claimScheduleTasksOwnership(
  userCode: string,
  taskRepo: ScheduleTaskRepository = new ScheduleTaskRepository(),
): Promise<{ skipped: boolean; claimed: number }> {
  const code = userCode.trim();
  if (!code) return { skipped: true, claimed: 0 };

  const home = getStoClawHomeDir();
  mkdirSync(home, { recursive: true });
  const markerPath = getOwnershipClaimMarkerPath();
  if (readMarker(markerPath)) {
    return { skipped: true, claimed: 0 };
  }

  const claimed = await taskRepo.claimNullCreatedBy(code);
  const marker: OwnershipClaimMarker = {
    claimedBy: code,
    count: claimed,
    completedAt: new Date().toISOString(),
  };
  writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
  logger.info('[scheduled-task] ownership claimed', { claimedBy: code, count: claimed });
  return { skipped: false, claimed };
}
