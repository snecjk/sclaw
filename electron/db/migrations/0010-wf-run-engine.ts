import type { SqliteDatabase, SqliteMigration } from '../types';

function hasColumn(db: SqliteDatabase, column: string): boolean {
  return (db.prepare('PRAGMA table_info(wf_run)').all() as Array<{ name: string }>)
    .some((entry) => entry.name === column);
}

/** Pins the execution engine so recovery never changes an in-flight run's behavior. */
export const wfRunEngineMigration: SqliteMigration = {
  version: 10,
  name: 'wf-run-engine',
  apply: (db) => {
    if (!hasColumn(db, 'engine_type')) {
      db.exec("ALTER TABLE wf_run ADD COLUMN engine_type TEXT NOT NULL DEFAULT 'claude'");
    }
    if (!hasColumn(db, 'engine_model')) {
      db.exec('ALTER TABLE wf_run ADD COLUMN engine_model TEXT');
    }
  },
};

export default wfRunEngineMigration;
