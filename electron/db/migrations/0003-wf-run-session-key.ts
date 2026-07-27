import type { SqliteDatabase, SqliteMigration } from '../types';

function hasColumn(db: SqliteDatabase, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .some((entry) => entry.name === column);
}

/**
 * 0003 — 给 wf_run 加 session_key 列。
 *
 * status-update emit 桥（gap2）按 sessionKey 过滤广播（use-workflow-completion.ts:47），
 * 但 engine 只有 runId。落 run 时一并写 session_key，emit 桥发广播前从 run 行读取。
 * 也服务 gap3 hydration（getRun 返回 session_key 供 renderer 匹配）。
 *
 * 用 IF NOT EXISTS 式 ALTER（SQLite 不支持 ADD COLUMN IF NOT EXISTS，改用 try/catch
 * 幂等——重复应用时列已存在，PRAGMA table_info 探测后跳过）。
 */
export const wfRunSessionKeyMigration: SqliteMigration = {
  version: 3,
  name: 'wf-run-session-key',
  apply: (db) => {
    if (!hasColumn(db, 'wf_run', 'session_key')) {
      db.exec('ALTER TABLE wf_run ADD COLUMN session_key TEXT');
    }
  },
};

export default wfRunSessionKeyMigration;
