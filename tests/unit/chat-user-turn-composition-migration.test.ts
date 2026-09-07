// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import migration from '../../electron/db/migrations/0036-chat-user-turn-compositions';

let db: DatabaseSync | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

describe('chat user turn composition migration', () => {
  it('persists one status-tracked sidecar per session and idempotency key', () => {
    db = new DatabaseSync(':memory:');
    migration.apply?.(db);
    const insert = db.prepare(`
      INSERT INTO chat_user_turn_compositions (
        session_key, idempotency_key, run_id, engine_type, status,
        protocol_version, display_text, source_text, composition_json,
        attachments_json, error, created_at, updated_at
      ) VALUES (?, ?, NULL, 'pi', 'pending', 1, ?, ?, ?, '[]', NULL, ?, ?)
    `);
    const now = new Date().toISOString();
    insert.run('pi:main:test', 'turn-1', '查看文件', '查看文件', '{"version":1,"segments":[]}', now, now);
    expect(() => insert.run(
      'pi:main:test', 'turn-1', '重复', '重复', '{"version":1,"segments":[]}', now, now,
    )).toThrow();
    const row = db.prepare(
      'SELECT status, protocol_version, message_fingerprint, provider_message_id FROM chat_user_turn_compositions WHERE session_key = ?',
    ).get('pi:main:test') as {
      status: string;
      protocol_version: number;
      message_fingerprint: string;
      provider_message_id: string | null;
    };
    expect(row).toEqual({
      status: 'pending',
      protocol_version: 1,
      message_fingerprint: '',
      provider_message_id: null,
    });
  });
});
