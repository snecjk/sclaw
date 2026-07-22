import type { SqliteMigration } from '../types';

export const workflowRuntimeSchemaMigration: SqliteMigration = {
  version: 2,
  name: 'workflow-runtime-7-tables',
  sql: `
    CREATE TABLE IF NOT EXISTS wf_run (
      run_id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      version_id TEXT NOT NULL,
      status TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'CLIENT_LOCAL',
      source TEXT NOT NULL DEFAULT 'client',
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
      synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS wf_node_run (
      run_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      node_type TEXT,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      input_json TEXT,
      output_json TEXT,
      prompt_text TEXT,
      last_completion_issue TEXT,
      started_at TEXT,
      completed_at TEXT,
      PRIMARY KEY (run_id, node_id)
    );

    CREATE TABLE IF NOT EXISTS wf_event (
      run_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      type TEXT NOT NULL,
      node_id TEXT,
      run_ref_id TEXT,
      skill_id TEXT, tool_id TEXT, call_id TEXT, approval_id TEXT,
      output_uri TEXT, file_path TEXT,
      reason TEXT, message TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (run_id, sequence)
    );

    CREATE TABLE IF NOT EXISTS wf_artifact (
      artifact_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      node_id TEXT,
      kind TEXT NOT NULL,
      uri TEXT,
      file_path TEXT,
      resource_id TEXT,
      content_type TEXT, summary TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wf_approval_task (
      task_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL, node_id TEXT, status TEXT NOT NULL,
      assignee_role TEXT, reason TEXT, decision_note TEXT,
      requested_at TEXT, decided_at TEXT
    );

    CREATE TABLE IF NOT EXISTS wf_user_input_task (
      task_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL, node_id TEXT, status TEXT NOT NULL,
      assignee_role TEXT, title TEXT, instruction TEXT,
      form_schema_json TEXT, submitted_data_json TEXT,
      requested_at TEXT, submitted_at TEXT
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
    CREATE INDEX IF NOT EXISTS idx_wf_outbox_pending
      ON wf_outbox(status, next_retry_at) WHERE status='pending';
  `,
};

export default workflowRuntimeSchemaMigration;
