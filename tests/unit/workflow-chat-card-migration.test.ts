import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import workflowRuntimeSchemaMigration from '../../electron/db/migrations/0013-workflow-runtime-schema';

describe('workflow runtime schema chat-card columns', () => {
  let db: DatabaseSync | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it('creates durable card metadata with new runs invisible by default', () => {
    db = new DatabaseSync(':memory:');
    workflowRuntimeSchemaMigration.apply!(db);
    db.exec(`
      INSERT INTO wf_run(
        id, run_id, workflow_id, version_id, status, definition_json,
        started_at, updated_at, session_key
      ) VALUES (
        1, 'run-new', 'wf-1', 'version-1', 'RUNNING', '{}',
        '2026-07-30T10:00:00.000+08:00', '2026-07-30T10:00:00.000+08:00', 'session-1'
      );
    `);

    const newRun = db.prepare(`
      SELECT chat_card_visible, chat_anchor_user_message_id, chat_card_title, chat_params_summary
      FROM wf_run WHERE run_id = 'run-new'
    `).get() as Record<string, unknown>;
    expect(newRun).toEqual({
      chat_card_visible: 0,
      chat_anchor_user_message_id: null,
      chat_card_title: null,
      chat_params_summary: null,
    });

    const index = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND name = 'idx_wf_run_chat_session_started'
    `).get() as { name?: string } | undefined;
    expect(index?.name).toBe('idx_wf_run_chat_session_started');
  });
});
