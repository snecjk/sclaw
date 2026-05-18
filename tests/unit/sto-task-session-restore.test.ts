import { describe, expect, it } from 'vitest';
import { shouldRestoreMainSessionLeavingTaskSubitem } from '@/lib/sto-task-session';

describe('shouldRestoreMainSessionLeavingTaskSubitem', () => {
  const hidden = 'agent:main:sto-hq-reconciliation-2026-05-18';
  const regular = 'agent:main:session-abc';

  it('does not restore while on a task subitem route', () => {
    expect(
      shouldRestoreMainSessionLeavingTaskSubitem('/tasks/hq-reconciliation/2026-05-18', hidden),
    ).toBe(false);
  });

  it('restores when leaving task subitem with hidden session still active', () => {
    expect(shouldRestoreMainSessionLeavingTaskSubitem('/chat', hidden)).toBe(true);
    expect(shouldRestoreMainSessionLeavingTaskSubitem('/', hidden)).toBe(true);
  });

  it('does not restore when user already switched to a normal session', () => {
    expect(shouldRestoreMainSessionLeavingTaskSubitem('/chat', regular)).toBe(false);
  });
});
