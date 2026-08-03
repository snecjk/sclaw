import { describe, expect, it } from 'vitest';
import {
  isMainAgentChatSessionKey,
  isSidebarHiddenChatSessionKey,
  shouldRestoreMainSessionLeavingTaskSubitem,
} from '@/lib/sto-task-session';

describe('isSidebarHiddenChatSessionKey', () => {
  it('hides main agent sessions and task subitem sessions', () => {
    expect(isSidebarHiddenChatSessionKey('agent:main:main')).toBe(true);
    expect(isSidebarHiddenChatSessionKey('agent:research:main')).toBe(true);
    expect(isSidebarHiddenChatSessionKey('agent:main:sto-hq-reconciliation-2026-05-18')).toBe(true);
    expect(isSidebarHiddenChatSessionKey('agent:workflow-runtime:workflow:run-1:node-1')).toBe(true);
    expect(isSidebarHiddenChatSessionKey('agent:main:session-123')).toBe(false);
  });
});

describe('isMainAgentChatSessionKey', () => {
  it('matches canonical main session suffix only', () => {
    expect(isMainAgentChatSessionKey('agent:main:main')).toBe(true);
    expect(isMainAgentChatSessionKey('agent:foo:main')).toBe(true);
    expect(isMainAgentChatSessionKey('agent:main:session-1')).toBe(false);
  });
});

describe('shouldRestoreMainSessionLeavingTaskSubitem', () => {
  const hidden = 'agent:main:sto-hq-reconciliation-2026-05-18';
  const regular = 'agent:main:session-abc';

  it('does not restore while on a task subitem route', () => {
    expect(
      shouldRestoreMainSessionLeavingTaskSubitem('/tasks/hq-reconciliation/2026-05-18', hidden),
    ).toBe(false);
  });

  it('restores when leaving task subitem with hidden session still active', () => {
    expect(shouldRestoreMainSessionLeavingTaskSubitem('/', hidden)).toBe(true);
  });

  it('does not restore when user already switched to a normal session', () => {
    expect(shouldRestoreMainSessionLeavingTaskSubitem('/', regular)).toBe(false);
  });
});
