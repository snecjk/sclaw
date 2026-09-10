import type { SqliteMigration } from '../types';

/**
 * BAP 产物登记表（计划 §四 B11）：截图/PDF/read_page/抓包等二进制产物只落盘
 * （<userData>/browser-artifacts/），本表只登记元数据，二进制不入库（§六 R8）。
 * 纯增量：不改既有 ba_* 表结构。FK 声明对齐 0023 风格（仓内 PRAGMA foreign_keys=OFF，
 * 仅作文档性约束）。
 *
 * 编号 39：main 已占用 34–38（pi engine / skill states / compositions / activity / context usage）。
 */
export const browserAutomationArtifactsMigration: SqliteMigration = {
  version: 39,
  name: 'browser-automation-artifacts',
  apply(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ba_artifact (
        artifact_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        run_id TEXT,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        mime_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES ba_session(session_id),
        FOREIGN KEY (run_id) REFERENCES ba_run(run_id)
      );

      CREATE INDEX IF NOT EXISTS idx_ba_artifact_session ON ba_artifact(session_id);
      CREATE INDEX IF NOT EXISTS idx_ba_artifact_run ON ba_artifact(run_id);
    `);
  },
};

export default browserAutomationArtifactsMigration;
