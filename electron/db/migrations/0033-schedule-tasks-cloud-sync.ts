import type { SqliteMigration } from '../types';

function tableColumnNames(db: Parameters<NonNullable<SqliteMigration['apply']>>[0], table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => String(row.name)));
}

/**
 * 定时任务云端同步：本地 `schedule_tasks` 去掉与云端同名的 `version`，
 * 增加 `sync_status` / `remote_version`，并物理清掉启动当时的历史墓碑。
 */
export const scheduleTasksCloudSyncMigration: SqliteMigration = {
  version: 33,
  name: 'schedule-tasks-cloud-sync',
  apply(db) {
    const names = tableColumnNames(db, 'schedule_tasks');
    if (names.size === 0) return;

    if (!names.has('sync_status')) {
      db.exec(`
        ALTER TABLE schedule_tasks
          ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (sync_status IN ('pending', 'done'))
      `);
    }
    if (!names.has('remote_version')) {
      db.exec('ALTER TABLE schedule_tasks ADD COLUMN remote_version INTEGER NULL');
    }

    db.exec(`
      DELETE FROM schedule_task_runs
      WHERE task_id IN (SELECT id FROM schedule_tasks WHERE deleted_at IS NOT NULL);
      DELETE FROM schedule_tasks WHERE deleted_at IS NOT NULL;
    `);

    if (names.has('version')) {
      db.exec('ALTER TABLE schedule_tasks DROP COLUMN version');
    }

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_schedule_tasks_sync_pending
        ON schedule_tasks(created_by, sync_status)
        WHERE sync_status = 'pending'
    `);
  },
};

export default scheduleTasksCloudSyncMigration;
