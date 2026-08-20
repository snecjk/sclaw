import { describe, expect, it } from 'vitest';
import {
  buildTurnDisplayCacheKey,
  migrateTurnDisplayCache,
  mergeSegmentsMonotonic,
  mergeTurnSegmentMonotonic,
  readGlobalStableSegments,
  readGlobalStableTimeline,
  resolveLiveProjection,
  shouldPromoteActiveTurnCache,
  writeGlobalStableSegments,
  writeGlobalStableTimeline,
} from '../../src/pages/Chat/thinking/segment-merge';
import type { ThinkingTimelineItem } from '../../src/pages/Chat/message-utils';

const fullTimeline: ThinkingTimelineItem[] = [
  { type: 'thinking', content: 'analyze weather' },
  { type: 'tool', index: 1, id: 't1', name: 'exec', input: {} },
  { type: 'thinking', content: 'summarize results' },
];

describe('resolveLiveProjection', () => {
  it('does not let a longer stale cache hide a shorter updated live projection', () => {
    const cached = ['old-thinking', 'old-tool', 'old-status'];
    const incoming = ['current-growing-tool-input'];

    expect(resolveLiveProjection(incoming, cached, true)).toBe(incoming);
    expect(resolveLiveProjection([], cached, true)).toBe(cached);
    expect(resolveLiveProjection(incoming, cached, false)).toBeNull();
  });
});

describe('mergeTurnSegmentMonotonic', () => {
  it('does not downgrade completed tool-group to active on same key', () => {
    const cached = {
      kind: 'tool-group' as const,
      key: 'tool-group-batch-0',
      timeline: fullTimeline,
      state: 'completed' as const,
    };
    const incoming = {
      kind: 'tool-group' as const,
      key: 'tool-group-batch-0',
      timeline: [],
      state: 'active' as const,
    };

    const merged = mergeTurnSegmentMonotonic(cached, incoming);
    expect(merged).toMatchObject({
      kind: 'tool-group',
      key: 'tool-group-batch-0',
      state: 'completed',
    });
    expect((merged as typeof cached).timeline).toHaveLength(3);
  });

  it('keeps longer phase-text when incoming shrinks', () => {
    const cached = {
      kind: 'phase-text' as const,
      key: 'phase-text-after-0',
      text: '正在整理工具结果，请稍候…',
    };
    const incoming = {
      kind: 'phase-text' as const,
      key: 'phase-text-after-0',
      text: '正在整理',
    };

    const merged = mergeTurnSegmentMonotonic(cached, incoming);
    expect(merged).toMatchObject({ text: '正在整理工具结果，请稍候…' });
  });
});

describe('mergeSegmentsMonotonic', () => {
  it('preserves completed batch when parser collapses to single active group', () => {
    const cached = [
      {
        kind: 'tool-group' as const,
        key: 'tool-group-batch-0',
        timeline: fullTimeline,
        state: 'completed' as const,
      },
      {
        kind: 'phase-text' as const,
        key: 'phase-text-after-0',
        text: '接下来继续分析…',
      },
      {
        kind: 'tool-group' as const,
        key: 'tool-group-batch-1',
        timeline: [{ type: 'thinking', content: 'next round' }],
        state: 'active' as const,
      },
    ];
    const incoming = [
      {
        kind: 'tool-group' as const,
        key: 'tool-group-batch-0',
        timeline: [{ type: 'thinking', content: 'partial' }],
        state: 'active' as const,
      },
    ];

    const merged = mergeSegmentsMonotonic(cached, incoming);
    expect(merged).toHaveLength(3);
    expect(merged[0]).toMatchObject({
      key: 'tool-group-batch-0',
      state: 'completed',
    });
    expect((merged[0] as (typeof cached)[0]).timeline.length).toBeGreaterThanOrEqual(3);
    expect(merged[1]).toMatchObject({ key: 'phase-text-after-0' });
    expect(merged[2]).toMatchObject({ key: 'tool-group-batch-1', state: 'active' });
  });

  it('appends new segments from incoming while preserving cached order', () => {
    const cached = [
      {
        kind: 'tool-group' as const,
        key: 'tool-group-batch-0',
        timeline: fullTimeline,
        state: 'completed' as const,
      },
    ];
    const incoming = [
      {
        kind: 'tool-group' as const,
        key: 'tool-group-batch-0',
        timeline: fullTimeline,
        state: 'completed' as const,
      },
      {
        kind: 'phase-text' as const,
        key: 'phase-text-after-0',
        text: '短旁白',
      },
      {
        kind: 'tool-group' as const,
        key: 'tool-group-batch-1',
        timeline: [{ type: 'thinking', content: 'new batch' }],
        state: 'active' as const,
      },
    ];

    const merged = mergeSegmentsMonotonic(cached, incoming);
    expect(merged.map((s) => s.key)).toEqual([
      'tool-group-batch-0',
      'phase-text-after-0',
      'tool-group-batch-1',
    ]);
  });
});

describe('active-turn cache promotion', () => {
  it('only promotes when the same mounted turn transitions from active to stable', () => {
    expect(shouldPromoteActiveTurnCache(undefined, 'turn-user-new')).toBe(false);
    expect(shouldPromoteActiveTurnCache('turn-user-old', 'turn-user-new')).toBe(false);
    expect(shouldPromoteActiveTurnCache('active-turn', 'turn-user-new')).toBe(true);
  });

  it('isolates identical fallback turn keys by session', () => {
    const sessionAKey = buildTurnDisplayCacheKey('session-a', 'turn-0-0');
    const sessionBKey = buildTurnDisplayCacheKey('session-b', 'turn-0-0');
    expect(sessionAKey).toBe('session-a::turn-0-0');
    expect(sessionBKey).toBe('session-b::turn-0-0');
    expect(sessionAKey).not.toBe(sessionBKey);

    const segment = {
      kind: 'tool-group' as const,
      key: 'tool-group-session-a',
      timeline: fullTimeline,
      state: 'completed' as const,
    };
    writeGlobalStableSegments(sessionAKey, [segment]);

    expect(readGlobalStableSegments(sessionAKey)).toEqual([segment]);
    expect(readGlobalStableSegments(sessionBKey)).toEqual([]);
  });

  it('moves cached segments and timeline instead of leaving them for the next turn', () => {
    const sourceKey = 'active-turn-test-move';
    const targetKey = 'turn-user-test-move';
    const segment = {
      kind: 'tool-group' as const,
      key: 'tool-group-batch-0',
      timeline: fullTimeline,
      state: 'completed' as const,
    };
    writeGlobalStableSegments(sourceKey, [segment]);
    writeGlobalStableTimeline(sourceKey, segment.key, fullTimeline);

    migrateTurnDisplayCache(sourceKey, targetKey);

    expect(readGlobalStableSegments(targetKey)).toEqual([segment]);
    expect(readGlobalStableTimeline(targetKey, segment.key)).toEqual(fullTimeline);
    expect(readGlobalStableSegments(sourceKey)).toEqual([]);
    expect(readGlobalStableTimeline(sourceKey, segment.key)).toEqual([]);
  });
});
