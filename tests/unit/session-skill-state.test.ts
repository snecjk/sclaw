import { describe, expect, it } from 'vitest';
import {
  beginSessionSkillTurn,
  attachSessionSkillToTurn,
  emptySessionSkillState,
  finishSessionSkillTurn,
  markSessionSkillUsed,
  orderSessionSkillLeases,
  pruneSessionSkillLeases,
  recoverInterruptedSkillTurns,
  type SelectedSkillInput,
  type SessionSkillState,
} from '../../electron/services/skills/session-skill-state';

const selected = (slug: string, sourceHash = `${slug}-hash`) => ({ slug, sourceHash, state: 'selected' as const });

function begin(
  state: SessionSkillState,
  runId: string,
  skills: SelectedSkillInput[] = [selected('spreadsheets')],
  topicChanged = false,
) {
  return beginSessionSkillTurn(state, {
    runId,
    manifestRevision: 'manifest-1',
    query: 'create a workbook',
    selected: skills,
    remoteSearched: true,
    topicChanged,
  });
}

describe('session skill lease state', () => {
  it('does not increment the turn twice for the same run id', () => {
    const first = begin(emptySessionSkillState('session-1'), 'run-1');
    expect(begin(first, 'run-1')).toEqual(first);
    expect(first.turnNo).toBe(1);
  });

  it('keeps an unused selected skill for one following turn only', () => {
    let state = finishSessionSkillTurn(begin(emptySessionSkillState('session-1'), 'run-1'), 'run-1', true);
    state = begin(state, 'run-2', []);
    expect(state.skills.map((skill) => skill.slug)).toContain('spreadsheets');
    state = begin(state, 'run-3', []);
    expect(state.skills.map((skill) => skill.slug)).not.toContain('spreadsheets');
  });

  it('retains a used skill for three following turns and renews it only on actual use', () => {
    let state = begin(emptySessionSkillState('session-1'), 'run-1');
    state = markSessionSkillUsed(state, 'run-1', 'spreadsheets');
    state = finishSessionSkillTurn(state, 'run-1', true);
    expect(state.skills[0]).toMatchObject({ state: 'used', lastUsedTurn: 1, expiresAfterTurn: 4 });

    state = begin(state, 'run-2');
    state = finishSessionSkillTurn(state, 'run-2', true);
    expect(state.skills[0]).toMatchObject({ state: 'used', lastUsedTurn: 1, expiresAfterTurn: 4 });
    state = begin(state, 'run-3', []);
    state = begin(state, 'run-4', []);
    expect(state.skills).toHaveLength(1);
    state = begin(state, 'run-5', []);
    expect(state.skills).toHaveLength(0);
  });

  it('keeps pinned skills indefinitely and evicts non-pinned skills on a topic switch', () => {
    let state = begin(emptySessionSkillState('session-1'), 'run-1', [
      { ...selected('documents'), state: 'pinned' as const },
      selected('spreadsheets'),
    ]);
    state = finishSessionSkillTurn(state, 'run-1', true);
    state = begin(state, 'run-2', [{ ...selected('documents'), state: 'pinned' as const }], true);
    expect(state.skills).toHaveLength(1);
    expect(state.skills[0]).toMatchObject({ slug: 'documents', state: 'pinned', expiresAfterTurn: undefined });
  });

  it('removes disabled, uninstalled, or source-changed skills during reconciliation', () => {
    const state = finishSessionSkillTurn(begin(emptySessionSkillState('session-1'), 'run-1'), 'run-1', true);
    expect(pruneSessionSkillLeases(state, 2, new Map([['spreadsheets', 'new-hash']])).skills).toHaveLength(0);
    expect(pruneSessionSkillLeases(state, 2, new Map()).skills).toHaveLength(0);
  });

  it('does not retain usage observed in a failed turn', () => {
    const original = { ...emptySessionSkillState('session-1'), lastTaskFingerprint: 'previous-task' };
    let state = beginSessionSkillTurn(original, {
      runId: 'run-1',
      manifestRevision: 'manifest-1',
      query: 'new task',
      taskFingerprint: 'failed-task',
      selected: [selected('spreadsheets')],
      remoteSearched: true,
    });
    state = markSessionSkillUsed(state, 'run-1', 'spreadsheets');
    state = finishSessionSkillTurn(state, 'run-1', false);
    expect(state.skills[0]).toMatchObject({ state: 'selected', expiresAfterTurn: 2 });
    expect(state.lastTaskFingerprint).toBe('previous-task');
  });

  it('recovers interrupted pending turns without promoting their skills', () => {
    const state = markSessionSkillUsed(begin(emptySessionSkillState('session-1'), 'run-1'), 'run-1', 'spreadsheets');
    const recovered = recoverInterruptedSkillTurns(state);
    expect(recovered.pendingTurns).toEqual({});
    expect(recovered.skills[0].state).toBe('selected');
  });

  it('attaches a runtime-loaded skill to the active turn and promotes it on success', () => {
    let state = begin(emptySessionSkillState('session-1'), 'run-1', []);
    state = attachSessionSkillToTurn(state, undefined, {
      slug: 'documents',
      sourceHash: 'documents-hash',
      state: 'loaded',
    });
    expect(state.pendingTurns['run-1']).toMatchObject({
      selectedSlugs: ['documents'],
      loadedSlugs: ['documents'],
    });
    expect(state.skills[0]).toMatchObject({ slug: 'documents', state: 'loaded' });
    state = finishSessionSkillTurn(state, 'run-1', true);
    expect(state.skills[0]).toMatchObject({
      slug: 'documents',
      state: 'used',
      lastUsedTurn: 1,
      expiresAfterTurn: 4,
    });
  });

  it('orders pinned, used, loaded, and selected leases deterministically', () => {
    let state = begin(emptySessionSkillState('session-1'), 'run-1', [
      { ...selected('pinned'), state: 'pinned' as const, score: 1 },
      { ...selected('selected'), score: 999 },
      { ...selected('used'), state: 'used' as const, score: 2 },
      { ...selected('loaded'), state: 'loaded' as const, score: 500 },
    ]);
    state = markSessionSkillUsed(state, 'run-1', 'used');
    expect(orderSessionSkillLeases(state.skills).map((skill) => skill.slug)).toEqual(['pinned', 'used', 'loaded', 'selected']);
  });
});
