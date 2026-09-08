// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionSkillStateRepository } from '../../electron/db/repositories/session-skill-state-repository';
import { emptySessionSkillState } from '../../electron/services/skills/session-skill-state';
import { setupInMemoryDb, type InMemoryDb } from './helpers';

describe('SessionSkillStateRepository', () => {
  let memory: InMemoryDb;
  let repository: SessionSkillStateRepository;

  beforeEach(() => {
    memory = setupInMemoryDb();
    repository = new SessionSkillStateRepository();
  });

  afterEach(() => memory.teardown());

  it('persists and updates the complete session lease state', async () => {
    const state = {
      ...emptySessionSkillState('session-1'),
      turnNo: 2,
      manifestRevision: 'manifest-1',
      lastRemoteRouteTurn: 1,
      skills: [{
        slug: 'spreadsheets',
        sourceHash: 'hash-1',
        state: 'used' as const,
        score: 9,
        reasons: ['remote-hybrid'],
        selectedAtTurn: 1,
        lastUsedTurn: 2,
        expiresAfterTurn: 5,
      }],
      pendingTurns: {},
    };
    await repository.upsert(state);
    expect(await repository.get('session-1')).toEqual(state);

    await repository.upsert({ ...state, turnNo: 3, lastQuery: 'continue' });
    expect(await repository.get('session-1')).toMatchObject({ turnNo: 3, lastQuery: 'continue' });
    expect(await repository.count()).toBe(1);
  });

  it('deletes state with its session key', async () => {
    await repository.upsert(emptySessionSkillState('session-delete'));
    await repository.delete('session-delete');
    expect(await repository.get('session-delete')).toBeNull();
  });
});
