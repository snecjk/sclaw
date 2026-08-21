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
 * 已认证后归属认领：只补 `created_by IS NULL`（切号不抢已有工号）。
 * Marker 仅作审计；有无 marker 都跑认领，避免挡住登录后新出现的 NULL 行。
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
  const prior = readMarker(markerPath);

  const claimed = await taskRepo.claimNullCreatedBy(code);
  const marker: OwnershipClaimMarker = {
    claimedBy: code,
    count: claimed,
    completedAt: new Date().toISOString(),
  };
  writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
  if (claimed > 0 || !prior) {
    logger.info('[scheduled-task] ownership claimed', {
      claimedBy: code,
      count: claimed,
      priorClaimedBy: prior?.claimedBy ?? null,
    });
  }
  return { skipped: false, claimed };
}
