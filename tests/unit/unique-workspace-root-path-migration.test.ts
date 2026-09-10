import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import uniqueWorkspaceRootPathMigration from '../../electron/db/migrations/0041-unique-workspace-root-path';

describe('unique-workspace-root-path migration', () => {
  it('keeps the earliest workspace and soft-deletes later duplicates of the same folder', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL DEFAULT '',
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        version INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE catalog_sessions (
        workspace_id TEXT NOT NULL,
        session_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        PRIMARY KEY (workspace_id, session_key)
      );
    `);
    db.exec(`
      INSERT INTO workspaces (id, name, root_path, created_at, updated_at)
      VALUES
        ('keep', '0831002', '/tmp/0831002', '2026-09-10T03:22:56.989Z', '2026-09-10T03:22:56.989Z'),
        ('drop', '0831002', '/tmp/0831002/', '2026-09-10T03:24:23.718Z', '2026-09-10T03:24:23.718Z');
      INSERT INTO catalog_sessions (workspace_id, session_key, created_at, updated_at)
      VALUES
        ('keep', 'agent:main:a', '2026-09-10T03:22:56.989Z', '2026-09-10T03:22:56.989Z'),
        ('drop', 'agent:main:b', '2026-09-10T03:24:23.718Z', '2026-09-10T03:24:23.718Z');
    `);

    uniqueWorkspaceRootPathMigration.apply!(db);

    const active = db.prepare(
      'SELECT id, root_path, deleted_at FROM workspaces ORDER BY created_at',
    ).all() as Array<{ id: string; root_path: string; deleted_at: string | null }>;
    expect(active).toEqual([
      { id: 'keep', root_path: resolve('/tmp/0831002'), deleted_at: null },
      { id: 'drop', root_path: '/tmp/0831002/', deleted_at: expect.any(String) },
    ]);

    const sessions = db.prepare(
      'SELECT workspace_id, session_key, deleted_at FROM catalog_sessions ORDER BY session_key',
    ).all() as Array<{ workspace_id: string; session_key: string; deleted_at: string | null }>;
    expect(sessions).toEqual([
      { workspace_id: 'keep', session_key: 'agent:main:a', deleted_at: null },
      { workspace_id: 'keep', session_key: 'agent:main:b', deleted_at: null },
    ]);

    const index = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_workspaces_active_root_path'",
    ).get() as { name?: string } | undefined;
    expect(index?.name).toBe('idx_workspaces_active_root_path');
  });
});
