import { describe, it, expect, vi, afterAll } from 'vitest';

/**
 * `initializeSqliteDatabase()` is a singleton that derives its file path from
 * `app.getPath('userData')`. It accepts no arguments, so to run it against a
 * throwaway database in unit tests we redirect the `electron` main-process `app`
 * to a temp directory. This is the documented test seam: the real migration
 * pipeline (migrator + WAL pragmas + Kysely client) runs unchanged against a
 * temp-file SQLite database rather than the real userData path.
 *
 * `vi.hoisted` runs before module imports (and before the `vi.mock` factory) so
 * the temp path is available to both the mock factory and the test body.
 */
const tempUserDataDir = vi.hoisted(() => {
  const path = require('node:path');
  const os = require('node:os');
  const fs = require('node:fs');
  const dir = path.join(os.tmpdir(), `stoclaw-wf-test-${process.pid}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
});

vi.mock('electron', () => ({
  app: {
    getPath: () => tempUserDataDir,
    isPackaged: false,
    getAppPath: () => tempUserDataDir,
  },
}));

import { getSqliteDatabase, initializeSqliteDatabase } from '../../electron/db';

describe('workflow-runtime migration 0002', () => {
  afterAll(() => {
    // Release the file handle before removing the temp dir (WAL creates -wal/-shm siblings).
    try {
      getSqliteDatabase().close();
    } catch {
      // ignore — already closed or never opened
    }
    try {
      require('node:fs').rmSync(tempUserDataDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup; temp dir lives in os.tmpdir() regardless
    }
  });

  it('creates 7 workflow tables', () => {
    initializeSqliteDatabase();
    const db = getSqliteDatabase();
    const rows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'wf_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    const names = rows.map((row) => row.name);

    expect(names).toEqual([
      'wf_approval_task',
      'wf_artifact',
      'wf_event',
      'wf_node_run',
      'wf_outbox',
      'wf_run',
      'wf_user_input_task',
    ]);
  });

  it('registers the partial pending index on wf_outbox', () => {
    const db = getSqliteDatabase();
    const rows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='wf_outbox' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    const names = rows.map((row) => row.name);

    expect(names).toContain('idx_wf_outbox_pending');
  });

  it('records migration version 2 in schema_migrations', () => {
    const db = getSqliteDatabase();
    const row = db
      .prepare('SELECT version, name FROM schema_migrations WHERE version = 2')
      .get() as { version: number; name: string } | undefined;

    expect(row).toBeDefined();
    expect(row?.name).toBe('workflow-runtime-7-tables');
  });
});
