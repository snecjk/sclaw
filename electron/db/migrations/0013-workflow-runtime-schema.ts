import type { SqliteMigration } from '../types';

/**
 * First production workflow-runtime schema.
 *
 * Workflow runtime tables have not been released to production, so this
 * migration creates the final schema in one transaction instead of carrying
 * forward the local-only incremental upgrade history. Older development
 * builds may already have tables with these names but incompatible schemas;
 * when this migration first runs, those local-only tables are discarded and
 * rebuilt as the final schema.
 */
export const workflowRuntimeSchemaMigration: SqliteMigration = {
  version: 13,
  name: 'workflow-runtime-schema',
  apply(db) {
    // This migration is only invoked when schema_migrations does not yet have
    // v13. Drop every runtime table unconditionally so a user running an older
    // client cannot retain a same-named development table with an incompatible
    // shape (including tables that happen to have an `id` column already).
    db.exec(`
      DROP TABLE IF EXISTS wf_outbox;
      DROP TABLE IF EXISTS wf_user_input_task;
      DROP TABLE IF EXISTS wf_approval_task;
      DROP TABLE IF EXISTS wf_artifact;
      DROP TABLE IF EXISTS wf_event;
      DROP TABLE IF EXISTS wf_node_run;
      DROP TABLE IF EXISTS wf_run;
    `);

    db.exec(`
    CREATE TABLE IF NOT EXISTS wf_run (
      id INTEGER PRIMARY KEY,
      run_id TEXT NOT NULL UNIQUE,
      workflow_id TEXT NOT NULL,
      version_id TEXT NOT NULL,
      workflow_version TEXT,
      status TEXT NOT NULL,
      session_key TEXT,
      engine_type TEXT NOT NULL DEFAULT 'claude',
      engine_model TEXT,
      mode TEXT NOT NULL DEFAULT 'CLIENT_LOCAL',
      source TEXT NOT NULL DEFAULT 'client',
      trigger_type TEXT NOT NULL DEFAULT 'workflow_manual',
      waiting_node_id TEXT,
      input_json TEXT,
      output_json TEXT,
      last_agent_output_json TEXT,
      last_agent_raw_text TEXT,
      definition_json TEXT NOT NULL,
      error TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      updated_at TEXT NOT NULL,
      synced_at TEXT,
      chat_card_visible INTEGER NOT NULL DEFAULT 0,
      chat_anchor_user_message_id TEXT,
      chat_card_title TEXT,
      chat_params_summary TEXT,
      created_at TEXT,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS wf_node_run (
      id INTEGER PRIMARY KEY,
      run_id INTEGER NOT NULL REFERENCES wf_run(id),
      node_id TEXT NOT NULL,
      node_type TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      agent_session_id TEXT,
      input_json TEXT,
      output_json TEXT,
      prompt_text TEXT,
      last_completion_issue TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT,
      UNIQUE(run_id, node_id)
    );

    CREATE TABLE IF NOT EXISTS wf_event (
      id INTEGER PRIMARY KEY,
      run_id INTEGER NOT NULL REFERENCES wf_run(id),
      sequence INTEGER NOT NULL,
      type TEXT NOT NULL,
      node_id TEXT,
      run_ref_id TEXT,
      skill_id TEXT,
      tool_id TEXT,
      call_id TEXT,
      approval_id TEXT,
      output_uri TEXT,
      file_path TEXT,
      reason TEXT,
      message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      deleted_at TEXT,
      UNIQUE(run_id, sequence)
    );

    CREATE TABLE IF NOT EXISTS wf_artifact (
      id INTEGER PRIMARY KEY,
      artifact_id TEXT NOT NULL UNIQUE,
      run_id INTEGER NOT NULL REFERENCES wf_run(id),
      node_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      uri TEXT NOT NULL,
      file_path TEXT,
      resource_id TEXT,
      content_type TEXT,
      summary TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      deleted_at TEXT,
      UNIQUE(run_id, node_id, uri)
    );

    CREATE TABLE IF NOT EXISTS wf_approval_task (
      id INTEGER PRIMARY KEY,
      task_id TEXT NOT NULL UNIQUE,
      run_id INTEGER NOT NULL REFERENCES wf_run(id),
      node_id TEXT NOT NULL,
      status TEXT NOT NULL,
      assignee_role TEXT,
      reason TEXT,
      decision_note TEXT,
      requested_at TEXT NOT NULL,
      decided_at TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS wf_user_input_task (
      id INTEGER PRIMARY KEY,
      task_id TEXT NOT NULL UNIQUE,
      run_id INTEGER NOT NULL REFERENCES wf_run(id),
      node_id TEXT NOT NULL,
      status TEXT NOT NULL,
      assignee_role TEXT,
      title TEXT,
      instruction TEXT,
      form_schema_json TEXT NOT NULL,
      submitted_data_json TEXT,
      requested_at TEXT NOT NULL,
      submitted_at TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS wf_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_ref TEXT NOT NULL,
      payload TEXT NOT NULL,
      sync_kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT,
      created_at TEXT NOT NULL,
      synced_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_wf_node_run_run_status ON wf_node_run(run_id, status);
    CREATE INDEX IF NOT EXISTS idx_wf_event_type ON wf_event(type);
    CREATE INDEX IF NOT EXISTS idx_wf_artifact_run_kind ON wf_artifact(run_id, kind);
    CREATE INDEX IF NOT EXISTS idx_wf_approval_run_status ON wf_approval_task(run_id, status);
    CREATE INDEX IF NOT EXISTS idx_wf_input_run_status ON wf_user_input_task(run_id, status);
    CREATE INDEX IF NOT EXISTS idx_wf_outbox_pending
      ON wf_outbox(status, next_retry_at) WHERE status = 'pending';
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_wf_run_chat_session_started
        ON wf_run(session_key, chat_card_visible, started_at);
      CREATE INDEX IF NOT EXISTS idx_wf_run_trigger_started
        ON wf_run(trigger_type, started_at);
    `);
  },
};

export default workflowRuntimeSchemaMigration;
