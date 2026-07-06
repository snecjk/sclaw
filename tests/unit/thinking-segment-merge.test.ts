import { describe, expect, it } from 'vitest';
import {
  mergeSegmentsMonotonic,
  mergeTurnSegmentMonotonic,
} from '../../src/pages/Chat/thinking/segment-merge';
import type { ThinkingTimelineItem } from '../../src/pages/Chat/message-utils';

const fullTimeline: ThinkingTimelineItem[] = [
  { type: 'thinking', content: 'analyze weather' },
  { type: 'tool', index: 1, id: 't1', name: 'exec', input: {} },
  { type: 'thinking', content: 'summarize results' },
];

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
