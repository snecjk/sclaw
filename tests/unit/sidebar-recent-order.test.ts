import { describe, expect, it } from 'vitest';
import {
  buildInitialSidebarRecentOrder,
  mergeSidebarRecentOrder,
  prependSidebarRecentOrder,
  sortSessionsByFrozenRecentOrder,
} from '@/lib/sidebar-recent-order';
import type { ChatSession } from '@/stores/chat/types';

const sessions: ChatSession[] = [
  { key: 'agent:main:session-a', updatedAt: 100 },
  { key: 'agent:main:session-b', updatedAt: 300 },
  { key: 'agent:main:session-c', updatedAt: 200 },
];

describe('buildInitialSidebarRecentOrder', () => {
  it('orders by updatedAt descending on fresh install', () => {
    expect(buildInitialSidebarRecentOrder(sessions, {})).toEqual([
      'agent:main:session-b',
      'agent:main:session-c',
      'agent:main:session-a',
    ]);
  });
});

describe('sortSessionsByFrozenRecentOrder', () => {
  it('keeps frozen order when click updates sessionLastActivity', () => {
    const frozen = buildInitialSidebarRecentOrder(sessions, {});
    const activityAfterClick = {
      'agent:main:session-a': 999_999,
    };
    const sorted = sortSessionsByFrozenRecentOrder(sessions, frozen, activityAfterClick);
    expect(sorted.map((session) => session.key)).toEqual(frozen);
  });
});

describe('mergeSidebarRecentOrder', () => {
  it('appends new keys without reordering existing ones', () => {
    expect(mergeSidebarRecentOrder(
      ['agent:main:session-a', 'agent:main:session-b'],
      ['agent:main:session-b', 'agent:main:session-a', 'agent:main:session-new'],
    )).toEqual([
      'agent:main:session-a',
      'agent:main:session-b',
      'agent:main:session-new',
    ]);
  });
});

describe('prependSidebarRecentOrder', () => {
  it('puts a newly created session at the top', () => {
    expect(prependSidebarRecentOrder(['a', 'b'], 'new')).toEqual(['new', 'a', 'b']);
  });
});
