import { describe, expect, it } from 'vitest';
import {
  buildInitialSidebarRecentOrder,
  prependSidebarRecentOrder,
  removeSidebarRecentOrderKey,
  scrubClaudeSessionLastActivity,
  sortSessionsByRecentActivity,
  sortSessionsWithCatalogPin,
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

  it('excludes app-dev workbench sessions from recent order', () => {
    expect(buildInitialSidebarRecentOrder([
      ...sessions,
      { key: 'agent:proj-a:appdev:workspace-1', updatedAt: 999 },
    ], {})).toEqual([
      'agent:main:session-b',
      'agent:main:session-c',
      'agent:main:session-a',
    ]);
  });

  it('excludes PI workflow node sessions from recent order', () => {
    expect(buildInitialSidebarRecentOrder([
      ...sessions,
      { key: 'pi:workflow:node-session', engineType: 'pi', updatedAt: 999 },
    ], {})).toEqual([
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

describe('sortSessionsWithCatalogPin', () => {
  it('keeps pinned sessions above unpinned ones', () => {
    const sorted = sortSessionsWithCatalogPin(
      [
        { key: 'agent:main:session-a' },
        { key: 'agent:main:session-b' },
        { key: 'agent:main:session-c' },
      ],
      {
        'agent:main:session-a': 100,
        'agent:main:session-b': 300,
        'agent:main:session-c': 200,
      },
      {
        'agent:main:session-a': { pinRank: 1, lastActivityAt: null },
      },
    );
    expect(sorted.map((session) => session.key)).toEqual([
      'agent:main:session-a',
      'agent:main:session-b',
      'agent:main:session-c',
    ]);
  });

  it('sorts pinned sessions by last activity descending instead of pin rank', () => {
    const sorted = sortSessionsWithCatalogPin(
      [
        { key: 'agent:main:session-a' },
        { key: 'agent:main:session-b' },
        { key: 'agent:main:session-c' },
      ],
      {
        'agent:main:session-a': 100,
        'agent:main:session-b': 300,
        'agent:main:session-c': 200,
      },
      {
        'agent:main:session-a': { pinRank: 1, lastActivityAt: null },
        'agent:main:session-c': { pinRank: 5, lastActivityAt: null },
      },
    );
    expect(sorted.map((session) => session.key)).toEqual([
      'agent:main:session-c',
      'agent:main:session-a',
      'agent:main:session-b',
    ]);
  });

  it('uses catalog lastActivityAt when it is newer than local activity', () => {
    const sorted = sortSessionsWithCatalogPin(
      [
        { key: 'agent:main:session-a' },
        { key: 'agent:main:session-b' },
      ],
      {
        'agent:main:session-a': 100,
        'agent:main:session-b': 200,
      },
      {
        'agent:main:session-a': { pinRank: 1, lastActivityAt: '2026-07-16T10:00:00.000Z' },
        'agent:main:session-b': { pinRank: 1, lastActivityAt: '2026-07-16T12:00:00.000Z' },
      },
    );
    expect(sorted.map((session) => session.key)).toEqual([
      'agent:main:session-b',
      'agent:main:session-a',
    ]);
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
