import { describe, expect, it } from 'vitest';
import {
  buildInitialSidebarRecentOrder,
  prependSidebarRecentOrder,
  removeSidebarRecentOrderKey,
  sortSessionsByRecentActivity,
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

describe('sortSessionsByRecentActivity', () => {
  it('reorders when sessionLastActivity increases after send/receive', () => {
    const sorted = sortSessionsByRecentActivity(sessions, {
      'agent:main:session-a': 999_999,
    });
    expect(sorted.map((session) => session.key)).toEqual([
      'agent:main:session-a',
      'agent:main:session-b',
      'agent:main:session-c',
    ]);
  });

  it('keeps order stable when activity is unchanged (view only)', () => {
    const initial = sortSessionsByRecentActivity(sessions, {});
    const afterView = sortSessionsByRecentActivity(sessions, {});
    expect(afterView.map((session) => session.key)).toEqual(
      initial.map((session) => session.key),
    );
  });
});

describe('prependSidebarRecentOrder', () => {
  it('puts a newly created session at the top', () => {
    expect(prependSidebarRecentOrder(['a', 'b'], 'new')).toEqual(['new', 'a', 'b']);
  });
});

describe('removeSidebarRecentOrderKey', () => {
  it('removes a deleted session key', () => {
    expect(removeSidebarRecentOrderKey(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });
});
