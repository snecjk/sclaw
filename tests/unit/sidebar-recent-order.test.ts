import { describe, expect, it } from 'vitest';
import {
  buildInitialSidebarRecentOrder,
  prependSidebarRecentOrder,
  removeSidebarRecentOrderKey,
  scrubClaudeSessionLastActivity,
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

  it('prefers healed transcript activity over inflated Claude registry updatedAt', () => {
    const mixed: ChatSession[] = [
      { key: 'agent:main:claude-a', engineType: 'claude', updatedAt: 100 },
      { key: 'agent:main:openclaw-b', engineType: 'openclaw', updatedAt: 500_000 },
    ];
    const activity = scrubClaudeSessionLastActivity(mixed, {
      'agent:main:claude-a': 999_999,
    });
    const sorted = sortSessionsByRecentActivity(mixed, activity);
    expect(sorted.map((session) => session.key)).toEqual([
      'agent:main:openclaw-b',
      'agent:main:claude-a',
    ]);
  });
});

describe('scrubClaudeSessionLastActivity', () => {
  it('clears legacy read-bump timestamps that exceed transcript activity', () => {
    const sessions: ChatSession[] = [
      { key: 'agent:main:claude-a', engineType: 'claude', updatedAt: 100 },
    ];
    const scrubbed = scrubClaudeSessionLastActivity(sessions, {
      'agent:main:claude-a': 999_999,
    });
    expect(scrubbed['agent:main:claude-a']).toBe(100);
  });

  it('keeps recent send activity that is only slightly ahead of transcript time', () => {
    const sessions: ChatSession[] = [
      { key: 'agent:main:claude-a', engineType: 'claude', updatedAt: 100 },
    ];
    const scrubbed = scrubClaudeSessionLastActivity(sessions, {
      'agent:main:claude-a': 180_000,
    });
    expect(scrubbed['agent:main:claude-a']).toBe(180_000);
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
