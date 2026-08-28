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
    runtimePolicy: { origin: 'interactive', deadlineAt: 1_200_100 },
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

  it('rejects an older epoch or sequence without regressing the stored snapshot', async () => {
    await expect(repository.upsertIfNewer(snapshot({
      epoch: 2,
      sequence: 8,
      phase: 'completed',
      terminalAt: 800,
      updatedAt: 800,
    }))).resolves.toBe('inserted');
    await expect(repository.upsertIfNewer(snapshot({
      epoch: 2,
      sequence: 7,
      phase: 'running',
      updatedAt: 900,
    }))).resolves.toBe('stale');
    await expect(repository.upsertIfNewer(snapshot({
      epoch: 1,
      sequence: 99,
      phase: 'running',
      updatedAt: 1_000,
    }))).resolves.toBe('stale');
    await expect(repository.getByIdempotencyKey('agent:main:session-1', 'message-1'))
      .resolves.toMatchObject({ epoch: 2, sequence: 8, phase: 'completed' });
  });

  it('lets a terminal snapshot repair a same-sequence active row', async () => {
    await expect(repository.upsertIfNewer(snapshot({
      runId: 'run-1',
      phase: 'running',
      sequence: 14,
      lastEventAt: 140,
      updatedAt: 140,
    }))).resolves.toBe('inserted');

    await expect(repository.upsertIfNewer(snapshot({
      runId: 'run-1',
      phase: 'completed',
      sequence: 14,
      lastEventAt: 150,
      terminalAt: 150,
      updatedAt: 150,
    }))).resolves.toBe('updated');

    await expect(repository.upsertIfNewer(snapshot({
      runId: 'run-1',
      phase: 'running',
      sequence: 14,
      lastEventAt: 160,
      updatedAt: 160,
    }))).resolves.toBe('stale');

    await expect(repository.getByIdempotencyKey('agent:main:session-1', 'message-1'))
      .resolves.toMatchObject({
        phase: 'completed', sequence: 14, terminalAt: 150,
      });
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

  it('persists scheduled-task ownership and resolves a run by owner', async () => {
    await repository.upsert(snapshot({
      runtimePolicy: {
        origin: 'scheduled_task',
        ownerId: 'schedule-run-1',
        deadlineAt: 60_100,
      },
    }));

    await expect(repository.getByOwner('scheduled_task', 'schedule-run-1')).resolves.toMatchObject({
      runtimePolicy: {
        origin: 'scheduled_task',
        ownerId: 'schedule-run-1',
        deadlineAt: 60_100,
      },
    });
  });

  it('persists bridge origin and resolves a run by owner', async () => {
    await repository.upsert(snapshot({
      sessionKey: 'agent:main:bridge-ai:demo:c1',
      runtimePolicy: {
        origin: 'bridge',
        ownerId: 'bridge-request-1',
        deadlineAt: 90_000,
      },
    }));

    await expect(repository.getByOwner('bridge', 'bridge-request-1')).resolves.toMatchObject({
      sessionKey: 'agent:main:bridge-ai:demo:c1',
      runtimePolicy: {
        origin: 'bridge',
        ownerId: 'bridge-request-1',
        deadlineAt: 90_000,
      },
    });
  });

  it('persists Pi as an immutable runtime engine snapshot', async () => {
    await repository.upsert(snapshot({
      sessionKey: 'pi:main:session-1',
      engineType: 'pi',
    }));
    await expect(repository.getByIdempotencyKey('pi:main:session-1', 'message-1'))
      .resolves.toMatchObject({ engineType: 'pi' });
  });

  it('prunes terminal overflow with SQLite-compatible limit and offset syntax', async () => {
    await Promise.all(Array.from({ length: 501 }, (_, index) => repository.upsert(snapshot({
      sessionKey: `agent:main:terminal-${index}`,
      idempotencyKey: `message-${index}`,
      runId: `run-${index}`,
      phase: 'completed',
      terminalAt: 10_000 + index,
      updatedAt: 10_000 + index,
    }))));

    await expect(repository.prune(20_000)).resolves.toBeUndefined();
    const row = memory.db.prepare('SELECT COUNT(*) AS count FROM chat_runtime_runs').get() as { count: number };
    expect(row.count).toBe(500);
    await expect(repository.getLatestForSession('agent:main:terminal-500')).resolves.not.toBeNull();
    await expect(repository.getLatestForSession('agent:main:terminal-0')).resolves.toBeNull();
  });
});
