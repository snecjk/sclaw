import type { SqliteDatabase, SqliteMigration } from '../types';
import { rebuildWorkflowRuntimeTables } from './workflow-runtime-schema';

function hasColumn(db: SqliteDatabase, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .some((entry) => entry.name === column);
}

/**
 * Repairs installations that recorded an old workflow migration without
 * receiving its final cloud-primary-key table definition.
 */
export const workflowRuntimeSchemaRepairMigration: SqliteMigration = {
  version: 12,
  name: 'workflow-runtime-canonical-schema-repair',
  apply: (db) => {
    if (!hasColumn(db, 'wf_run', 'id')) {
      rebuildWorkflowRuntimeTables(db);
    }
  },
};

export default workflowRuntimeSchemaRepairMigration;
