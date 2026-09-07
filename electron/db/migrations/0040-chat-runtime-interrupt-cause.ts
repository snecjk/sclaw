import type { SqliteMigration } from '../types';

function tableColumnNames(
  db: Parameters<NonNullable<SqliteMigration['apply']>>[0],
  table: string,
): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => String(row.name)));
}

/**
 * 中断原因进 chat_runtime_runs，续跑读库而不是进程内 Map。
 * 编号 40：main 已占用 34–38。
 */
export const chatRuntimeInterruptCauseMigration: SqliteMigration = {
  version: 40,
  name: 'chat-runtime-interrupt-cause',
  apply(db) {
    const names = tableColumnNames(db, 'chat_runtime_runs');
    if (names.size === 0 || names.has('interrupt_cause')) return;
    db.exec('ALTER TABLE chat_runtime_runs ADD COLUMN interrupt_cause TEXT');
  },
};

export default chatRuntimeInterruptCauseMigration;
