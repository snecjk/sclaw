import type { SqliteMigration } from '../types';

function tableColumnNames(
  db: Parameters<NonNullable<SqliteMigration['apply']>>[0],
  table: string,
): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => String(row.name)));
}

export const chatContextUsageMigration: SqliteMigration = {
  version: 38,
  name: 'chat-context-usage',
  apply(db) {
    const names = tableColumnNames(db, 'chat_runtime_runs');
    if (names.size === 0 || names.has('context_usage_json')) return;
    db.exec('ALTER TABLE chat_runtime_runs ADD COLUMN context_usage_json TEXT;');
  },
};

export default chatContextUsageMigration;
