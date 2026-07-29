import type { SqliteMigration } from '../types';

export const scheduleTasksMigration: SqliteMigration = {
  // version=11 避开存量库 v6 占位：部分开发库经历过并行 workflow-runtime 分支的
  // version 体系（库里 v6=memory-capture-jobs）。migrator 只比 version 不比 name，
  // v6 被占会静默 skip → schedule_tasks 永不建表 → 数据迁移炸在 getById。
  // 0006 是本分支全新 migration，无任何库以 name=schedule-tasks 应用过，
  // CREATE TABLE IF NOT EXISTS 幂等，改号后所有库重启 migrator 会正确应用。
  // 文件名保留 0006（历史序号），version 字段才是 migrator 判定依据。
  version: 11,
  name: 'schedule-tasks',
  sql: `
    CREATE TABLE IF NOT EXISTS schedule_tasks (
      id                       TEXT PRIMARY KEY,
      name                     TEXT NOT NULL,
      enabled                  INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      cron_expr                TEXT NOT NULL,
      engine_type              TEXT NOT NULL,
      prompt                   TEXT NOT NULL,
      agent_id                 TEXT NOT NULL,
      workflow_code            TEXT,
      skill_code               TEXT,
      dingtalk_recipients_json TEXT CHECK (dingtalk_recipients_json IS NULL OR json_valid(dingtalk_recipients_json)),
      model                    TEXT,
      provider                 TEXT,
      account_id               TEXT,
      workspace_path              TEXT,
      my_artifact_folder_path     TEXT,
      shared_artifact_folder_path TEXT,
      permission_profile          TEXT,
      timeout_sec             INTEGER,
      retry_policy_json       TEXT CHECK (retry_policy_json IS NULL OR json_valid(retry_policy_json)),
      failure_policy_json     TEXT CHECK (failure_policy_json IS NULL OR json_valid(failure_policy_json)),
      extra_json              TEXT CHECK (extra_json IS NULL OR json_valid(extra_json)),
      next_run_at             TEXT,
      last_scheduled_for      TEXT,
      last_recovered_at        TEXT,
      cron_expr_snapshot      TEXT,
      created_at              TEXT NOT NULL,
      updated_at              TEXT NOT NULL,
      deleted_at              TEXT,
      version                 INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      created_by              TEXT,
      updated_by              TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_schedule_tasks_enabled_due
      ON schedule_tasks(enabled, next_run_at) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_schedule_tasks_engine
      ON schedule_tasks(engine_type) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_schedule_tasks_agent
      ON schedule_tasks(agent_id) WHERE deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS schedule_task_runs (
      run_id               TEXT PRIMARY KEY,
      task_id              TEXT NOT NULL,
      status               TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','timed_out','cancelled')),
      trigger_source       TEXT NOT NULL CHECK (trigger_source IN ('manual','schedule','recovery')),
      scheduled_for        TEXT,
      started_at           TEXT,
      completed_at         TEXT,
      attempt              INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),
      idempotency_key      TEXT NOT NULL,
      session_key          TEXT,
      summary              TEXT,
      error                TEXT,
      runtime_result_json  TEXT CHECK (runtime_result_json IS NULL OR json_valid(runtime_result_json)),
      created_at           TEXT NOT NULL,
      updated_at           TEXT NOT NULL,
      deleted_at           TEXT,
      version              INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      created_by           TEXT,
      updated_by           TEXT,
      FOREIGN KEY (task_id) REFERENCES schedule_tasks(id)
    );

    CREATE INDEX IF NOT EXISTS idx_schedule_task_runs_task_created
      ON schedule_task_runs(task_id, created_at DESC) WHERE deleted_at IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_task_runs_idem
      ON schedule_task_runs(task_id, idempotency_key) WHERE deleted_at IS NULL;
  `,
};

export default scheduleTasksMigration;
