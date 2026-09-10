import type { SqliteMigration } from '../types';

function tableColumnNames(
  db: Parameters<NonNullable<SqliteMigration['apply']>>[0],
  table: string,
): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => String(row.name)));
}

export const chatRuntimeActivityMigration: SqliteMigration = {
  version: 37,
  name: 'chat-runtime-activity',
  apply(db) {
    const names = tableColumnNames(db, 'chat_runtime_runs');
    if (names.size === 0 || names.has('activity_json')) return;
    db.exec('ALTER TABLE chat_runtime_runs ADD COLUMN activity_json TEXT;');
  },
};

export default chatRuntimeActivityMigration;
