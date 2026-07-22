import type { SqliteMigration } from '../types';

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
  sql: `ALTER TABLE wf_run ADD COLUMN session_key TEXT`,
};

export default wfRunSessionKeyMigration;
