/**
 * 启动期迁移：schedule_tasks 的
 * dingtalk_recipients_json / skill_code / workflow_code → extra.composerSegments，
 * 三列清 null（extra 真源收敛）。
 *
 * 幂等：marker 文件防重跑。
 *
 * 用法（手动预览）：
 *   const { runComposerColumnsToSegmentsMigration } = await import(
 *     '../scripts/migrate-composer-columns-to-segments'
 *   );
 *   await runComposerColumnsToSegmentsMigration(service, { dryRun: true });
 */
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ScheduledTaskService } from '../scheduled-tasks/scheduled-task-service';
import { getStoClawHomeDir } from '../utils/paths';
import { logger } from '../utils/logger';

const MARKER_FILENAME = 'composer-columns-to-segments.done';

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function runComposerColumnsToSegmentsMigration(
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
    logger.info('[migration] columns→composerSegments marker present — skip', {
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

  const result = await service.migrateComposerColumnsToSegments({
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
    logger.info('[migration] columns→composerSegments marker written', {
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
  planComposerColumnsToSegmentsMigration,
} from '../../shared/dingtalk-send/scheduled-task-dingtalk-lift';
