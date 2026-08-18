// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { SQLITE_MIGRATIONS } from '@electron/db/migrations';

function applyMigrations(db: DatabaseSync, predicate: (version: number) => boolean): void {
  for (const m of SQLITE_MIGRATIONS) {
    if (!predicate(m.version)) continue;
    db.exec('BEGIN IMMEDIATE;');
    if (m.apply) {
      m.apply(db);
    } else if (m.sql) {
      db.exec(m.sql);
    } else {
      throw new Error(`migration v${m.version} has no operation`);
    }
    db.exec('COMMIT;');
  }
}

// 按名而非 version 取迁移：0011-schedule-tasks 的 version=11 是为避开
// memory-capture-jobs 占用的 v6（详见 migration 文件头注释）。
// 写死 version 会让测试在改号后静默失效，故按 name 查找。
function migrationByName(name: string) {
  const m = SQLITE_MIGRATIONS.find((x) => x.name === name);
  if (!m) throw new Error(`migration "${name}" not found`);
  return m;
}

function tableNames(db: DatabaseSync): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

function indexNames(db: DatabaseSync): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name IS NOT NULL ORDER BY name")
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

/**
 * migration 0011：双场景 + 幂等 + 幂等键唯一索引。
 * 直接 apply 真实注册的 SQLITE_MIGRATIONS.sql（不触生产库、不依赖 migrator logger）。
 */
describe('schedule-tasks migration (0011)', () => {
  it('fresh DB: all migrations apply; schedule_tasks + schedule_task_runs + indexes present', () => {
    const db = new DatabaseSync(':memory:');
    applyMigrations(db, () => true);

    const tables = tableNames(db);
    expect(tables).toContain('schedule_tasks');
    expect(tables).toContain('schedule_task_runs');

    const indexes = indexNames(db);
    expect(indexes).toContain('idx_schedule_tasks_enabled_due');
    expect(indexes).toContain('idx_schedule_tasks_engine');
    expect(indexes).toContain('idx_schedule_tasks_agent');
    expect(indexes).toContain('idx_schedule_task_runs_task_created');
    expect(indexes).toContain('idx_schedule_task_runs_idem');
  });

  it('existing DB at v5: applying 0006 creates the new tables', () => {
    const db = new DatabaseSync(':memory:');
    applyMigrations(db, (v) => v <= 5);
    expect(tableNames(db)).not.toContain('schedule_tasks');

    db.exec(migrationByName('schedule-tasks').sql);

    expect(tableNames(db)).toContain('schedule_tasks');
    expect(tableNames(db)).toContain('schedule_task_runs');
  });

  it('idempotent: re-applying 0006 (CREATE ... IF NOT EXISTS) does not throw', () => {
    const db = new DatabaseSync(':memory:');
    applyMigrations(db, () => true);
    const sql = migrationByName('schedule-tasks').sql;
    expect(() => db.exec(sql)).not.toThrow();
  });

  it('schedule_task_runs enforces (task_id, idempotency_key) uniqueness unless soft-deleted', () => {
    const db = new DatabaseSync(':memory:');
    applyMigrations(db, () => true);
    const ts = '2026-07-23T00:00:00Z';
    db.prepare(
      `INSERT INTO schedule_tasks (id, name, enabled, cron_expr, engine_type, prompt, agent_id, created_at, updated_at)
       VALUES ('t1', 't', 1, '0 9 * * *', 'openclaw', 'p', 'main', ?, ?)`,
    ).run(ts, ts);
    const insertRun = (runId: string, key: string, t: string) =>
      db
        .prepare(
          `INSERT INTO schedule_task_runs (run_id, task_id, status, trigger_source, attempt, idempotency_key, created_at, updated_at)
           VALUES (?, 't1', 'running', 'manual', 1, ?, ?, ?)`,
        )
        .run(runId, key, t, t);
    expect(() => insertRun('r1', 't1:1', ts)).not.toThrow();
    // 同 (task_id, idempotency_key)、未软删 → 唯一冲突
    expect(() => insertRun('r2', 't1:1', '2026-07-23T00:00:01Z')).toThrow();
    // 软删后释放，可再用同 key
    db.prepare('UPDATE schedule_task_runs SET deleted_at = ? WHERE run_id = ?').run(
      '2026-07-23T00:00:02Z',
      'r1',
    );
    expect(() => insertRun('r3', 't1:1', '2026-07-23T00:00:03Z')).not.toThrow();
  });
});
