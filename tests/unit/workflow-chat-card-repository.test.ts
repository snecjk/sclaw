import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { Kysely } from 'kysely';
import type { SqliteDbSchema } from '../../electron/db/types';
import { createKyselySqliteClient } from '../../electron/db/kysely-sqlite';

const holder = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('../../electron/db/connection', () => ({
  getKyselyDatabase: () => holder.client,
}));

import { WorkflowRuntimeRepository } from '../../electron/db/repositories/workflow-runtime-repository';

describe('WorkflowRuntimeRepository chat cards', () => {
  let client: Kysely<SqliteDbSchema>;

  beforeEach(() => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE wf_run (
        run_id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        session_key TEXT,
        chat_card_visible INTEGER NOT NULL DEFAULT 0,
        chat_anchor_user_message_id TEXT,
        chat_card_title TEXT,
        chat_params_summary TEXT,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      INSERT INTO wf_run(run_id, workflow_id, session_key, started_at, updated_at)
      VALUES ('run-1', 'wf-1', 'session-a', '2026-07-30T10:00:00.000+08:00', '2026-07-30T10:00:00.000+08:00');
    `);
    client = createKyselySqliteClient(db);
    holder.client = client;
  });

  afterEach(async () => {
    await client.destroy();
  });

  it('registers idempotent metadata only for the originating session', async () => {
    const repository = new WorkflowRuntimeRepository();
    expect(await repository.listChatRunCardRefsBySession('session-a')).toEqual([]);

    await expect(repository.registerChatRunCard('run-1', {
      sessionKey: 'session-a',
      anchorUserMessageId: 'user-1',
      title: '天气工作流',
      paramsSummary: '城市：上海',
    })).resolves.toBe(true);
    await expect(repository.registerChatRunCard('run-1', {
      sessionKey: 'session-b',
      anchorUserMessageId: 'user-other',
      title: '其他会话',
    })).resolves.toBe(false);

    const refs = await repository.listChatRunCardRefsBySession('session-a');
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      run_id: 'run-1',
      session_key: 'session-a',
      chat_anchor_user_message_id: 'user-1',
      chat_card_title: '天气工作流',
      chat_params_summary: '城市：上海',
    });
    expect(await repository.listChatRunCardRefsBySession('session-b')).toEqual([]);
  });
});
