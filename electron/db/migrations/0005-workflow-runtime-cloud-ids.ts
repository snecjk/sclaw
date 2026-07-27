import type { SqliteDatabase, SqliteMigration } from '../types';
import { rebuildWorkflowRuntimeTables } from './workflow-runtime-schema';

function hasColumn(db: SqliteDatabase, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .some((entry) => entry.name === column);
}

/** Rebuild the unpublished local workflow schema with cloud-compatible ids.
 * Existing local workflow data is intentionally discarded. */
export const workflowRuntimeCloudIdsMigration: SqliteMigration = {
  version: 5,
  name: 'workflow-runtime-cloud-primary-keys',
  apply: (db) => {
    // New installations already received the canonical schema from v2. Older
    // v2-v4 databases used run_id as the primary key, so rebuild those only.
    if (hasColumn(db, 'wf_run', 'id')) return;

    rebuildWorkflowRuntimeTables(db);
  },
};

export default workflowRuntimeCloudIdsMigration;
