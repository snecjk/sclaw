import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupInMemoryDb, type InMemoryDb } from './helpers';
import { ChatRuntimeRepository } from '../../electron/db/repositories/chat-runtime-repository';
import type { ChatRuntimeSnapshot } from '../../shared/chat-runtime-protocol';

function snapshot(overrides: Partial<ChatRuntimeSnapshot> = {}): ChatRuntimeSnapshot {
  return {
    protocolVersion: 1,
    sessionKey: 'agent:main:session-1',
    runId: null,
    idempotencyKey: 'message-1',
    engineType: 'openclaw',
    phase: 'dispatching',
    epoch: 1,
    sequence: 1,
    startedAt: 100,
    lastEventAt: 100,
    terminalAt: null,
    error: null,
    acceptanceResult: null,
    updatedAt: 100,
    ...overrides,
  };
}

describe('chat runtime repository', () => {
  let memory: InMemoryDb;
  let repository: ChatRuntimeRepository;

  beforeEach(() => {
    memory = setupInMemoryDb();
    repository = new ChatRuntimeRepository();
  });

  afterEach(() => memory.teardown());

  it('persists and updates one run by session and idempotency key', async () => {
    await repository.upsert(snapshot());
    await repository.upsert(snapshot({
      runId: 'run-1',
      phase: 'running',
      sequence: 2,
      lastEventAt: 200,
      updatedAt: 200,
      acceptanceResult: { runId: 'run-1' },
    }));

    await expect(repository.getByIdempotencyKey('agent:main:session-1', 'message-1'))
      .resolves.toMatchObject({
        runId: 'run-1',
        phase: 'running',
        sequence: 2,
        acceptanceResult: { runId: 'run-1' },
      });
    await expect(repository.listActive()).resolves.toHaveLength(1);
  });

  it('uses a stable internal key for externally-started runs', async () => {
    const external = snapshot({ idempotencyKey: null, runId: 'run-external', phase: 'running' });
    await repository.upsert(external);
    await repository.upsert({ ...external, sequence: 2, lastEventAt: 200, updatedAt: 200 });
    const rows = memory.db.prepare('SELECT COUNT(*) AS count FROM chat_runtime_runs').get() as { count: number };
    expect(rows.count).toBe(1);
  });

  it('does not return terminal runs from active recovery', async () => {
    await repository.upsert(snapshot({
      runId: 'run-1',
      phase: 'completed',
      terminalAt: 300,
      updatedAt: 300,
    }));
    await expect(repository.listActive()).resolves.toEqual([]);
  });
});

