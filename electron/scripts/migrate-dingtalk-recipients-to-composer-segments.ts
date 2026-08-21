/**
 * 启动期迁移：schedule_tasks 收件人列 / prompt 块 → extra.composerSegments。
 *
 * 幂等：marker 文件防重跑；单行已有 extra mention segments 则 skip。
 *
 * 用法（手动预览）：
 *   const { runDingTalkRecipientsToComposerSegmentsMigration } = await import(
 *     '../scripts/migrate-dingtalk-recipients-to-composer-segments'
 *   );
 *   await runDingTalkRecipientsToComposerSegmentsMigration(service, { dryRun: true });
 */
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ScheduledTaskService } from '../scheduled-tasks/scheduled-task-service';
import { getStoClawHomeDir } from '../utils/paths';
import { logger } from '../utils/logger';

const MARKER_FILENAME = 'dingtalk-recipients-to-composer-segments.done';

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function runDingTalkRecipientsToComposerSegmentsMigration(
  service: ScheduledTaskService,
  options?: { dryRun?: boolean; force?: boolean },
): Promise<{
  skippedByMarker: boolean;
  scanned: number;
  migrated: number;
  skipped: number;
  dryRun: boolean;
}> {
  const dryRun = options?.dryRun === true;
  const force = options?.force === true;
  const markerFile = join(getStoClawHomeDir(), MARKER_FILENAME);

  if (!force && !dryRun && (await fileExists(markerFile))) {
    logger.info('[migration] dingtalk→composerSegments marker present — skip', {
      path: markerFile,
    });
    return {
      skippedByMarker: true,
      scanned: 0,
      migrated: 0,
      skipped: 0,
      dryRun: false,
    };
  }

  const result = await service.migrateDingTalkRecipientsToComposerSegments({
    dryRun,
  });

  if (!dryRun) {
    await mkdir(dirname(markerFile), { recursive: true });
    await writeFile(
      markerFile,
      JSON.stringify(
        {
          completedAt: new Date().toISOString(),
          scanned: result.scanned,
          migrated: result.migrated,
          skipped: result.skipped,
        },
        null,
        2,
      ),
      'utf8',
    );
    logger.info('[migration] dingtalk→composerSegments marker written', {
      path: markerFile,
      migrated: result.migrated,
      skipped: result.skipped,
    });
  }

  return {
    skippedByMarker: false,
    scanned: result.scanned,
    migrated: result.migrated,
    skipped: result.skipped,
    dryRun: result.dryRun,
  };
}

export {
  planComposerSegmentsRecipientsMigration,
  resolveScheduledTaskDingTalkRecipients,
} from '../../shared/dingtalk-send/scheduled-task-dingtalk-lift';
