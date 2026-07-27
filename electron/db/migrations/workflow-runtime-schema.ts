/**
 * Authoritative SQLite schema for the workflow runtime.
 *
 * Keep every workflow table definition here.  Historical migrations may
 * conditionally upgrade an already-created database, but must not introduce a
 * second definition of any of these tables.
 */
import type { SqliteDatabase } from '../types';

/**
 * Single source of truth for wf_node_run.  Both fresh databases and legacy
 * repairs consume these definitions, preventing a newly used column from
 * being added in one migration but omitted from the canonical CREATE TABLE.
 */
const WF_NODE_RUN_COLUMNS = [
  'id INTEGER PRIMARY KEY',
  'run_id INTEGER NOT NULL REFERENCES wf_run(id)',
  'node_id TEXT NOT NULL',
  'node_type TEXT',
  "status TEXT NOT NULL DEFAULT 'PENDING'",
  'attempt_count INTEGER NOT NULL DEFAULT 0',
  'agent_session_id TEXT',
  'input_json TEXT',
  'output_json TEXT',
  'prompt_text TEXT',
  'last_completion_issue TEXT',
  'started_at TEXT',
  'completed_at TEXT',
  'created_at TEXT',
  'updated_at TEXT',
  'deleted_at TEXT',
] as const;

const WF_NODE_RUN_COLUMNS_BY_NAME = new Map(
  WF_NODE_RUN_COLUMNS.map((definition) => [definition.split(' ', 1)[0], definition]),
);

const WF_NODE_RUN_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS wf_node_run (
    ${WF_NODE_RUN_COLUMNS.join(',\n    ')},
    UNIQUE(run_id, node_id)
  );
`;

export const WORKFLOW_RUNTIME_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS wf_run (
    id INTEGER PRIMARY KEY,
    run_id TEXT NOT NULL UNIQUE,
    workflow_id TEXT NOT NULL,
    version_id TEXT NOT NULL,
    workflow_version TEXT,
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
    synced_at TEXT,
    session_key TEXT,
    engine_type TEXT NOT NULL DEFAULT 'claude',
    engine_model TEXT,
    created_at TEXT,
    deleted_at TEXT
  );

  ${WF_NODE_RUN_TABLE_SQL}

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
`;

/**
 * Idempotently repairs additive wf_node_run columns for databases that have
 * already recorded a historical migration.  Key columns cannot be safely
 * added to an existing table, so their absence is handled by the v12 rebuild;
 * all runtime-owned non-key columns are repaired here from the same DDL list.
 */
export function ensureWorkflowNodeRunSchema(db: SqliteDatabase): void {
  const existingColumns = new Set(
    (db.prepare('PRAGMA table_info(wf_node_run)').all() as Array<{ name: string }>)
      .map((column) => column.name),
  );
  for (const columnName of WF_NODE_RUN_COLUMNS_BY_NAME.keys()) {
    if (['id', 'run_id', 'node_id'].includes(columnName) || existingColumns.has(columnName)) continue;
    const definition = WF_NODE_RUN_COLUMNS_BY_NAME.get(columnName);
    if (definition) db.exec(`ALTER TABLE wf_node_run ADD COLUMN ${definition}`);
  }
}

/** Replaces the pre-cloud workflow schema, whose data was intentionally ephemeral. */
export function rebuildWorkflowRuntimeTables(db: SqliteDatabase): void {
  db.exec(`
    DROP TABLE IF EXISTS wf_outbox;
    DROP TABLE IF EXISTS wf_user_input_task;
    DROP TABLE IF EXISTS wf_approval_task;
    DROP TABLE IF EXISTS wf_artifact;
    DROP TABLE IF EXISTS wf_event;
    DROP TABLE IF EXISTS wf_node_run;
    DROP TABLE IF EXISTS wf_run;
    ${WORKFLOW_RUNTIME_TABLES_SQL}
  `);
}
