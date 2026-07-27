import type { SqliteDatabase, SqliteMigration } from '../types';

function hasColumn(db: SqliteDatabase, column: string): boolean {
  return (db.prepare('PRAGMA table_info(wf_run)').all() as Array<{ name: string }>)
    .some((entry) => entry.name === column);
}

/** Stores the user-visible workflow version separately from the version row primary key. */
export const wfRunWorkflowVersionMigration: SqliteMigration = {
  version: 9,
  name: 'wf-run-workflow-version',
  apply: (db) => {
    if (!hasColumn(db, 'workflow_version')) {
      db.exec('ALTER TABLE wf_run ADD COLUMN workflow_version TEXT');
    }
  },
};

export default wfRunWorkflowVersionMigration;
