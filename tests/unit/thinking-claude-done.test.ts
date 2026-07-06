import { describe, expect, it } from 'vitest';
import {
  appendStreamingExtrasToTimeline,
  mergeTimelineMonotonic,
} from '../../src/lib/thinking-timeline-active';
import { shouldSkipDoneSegmentNormalize } from '../../src/pages/Chat/thinking/done-segment-normalize';
import { parseThinkingTurnLayout } from '../../src/pages/Chat/thinking-turn-segments';

describe('appendStreamingExtrasToTimeline', () => {
  it('appends distinct streaming tools not yet in parse timeline', () => {
    const timeline = [
      { type: 'thinking' as const, content: 'search' },
      {
        type: 'tool' as const,
        index: 1,
        id: 'toolu_a',
        name: 'web_search',
        input: { q: 'a' },
      },
    ];
    const streamingTools = [
      { toolCallId: 'toolu_b', name: 'web_search', input: { q: 'b' } },
      { toolCallId: 'toolu_c', name: 'exec', input: { cmd: 'x' } },
    ];

    const merged = appendStreamingExtrasToTimeline(timeline, streamingTools);
    expect(merged.filter((item) => item.type === 'tool')).toHaveLength(3);
  });
});

describe('mergeTimelineMonotonic with streaming bake', () => {
  it('keeps cached tool count when done parse timeline shrinks', () => {
    const cached = appendStreamingExtrasToTimeline(
      [{ type: 'thinking', content: 'plan' }],
      [
        { toolCallId: 't1', name: 'exec', input: { n: 1 } },
        { toolCallId: 't2', name: 'exec', input: { n: 2 } },
        { toolCallId: 't3', name: 'exec', input: { n: 3 } },
      ],
    );
    const incoming = [
      { type: 'thinking' as const, content: 'plan' },
      {
        type: 'tool' as const,
        index: 1,
        id: 'exec',
        name: 'exec',
        input: { n: 1 },
      },
    ];

    const merged = mergeTimelineMonotonic(cached, incoming);
    expect(merged.filter((item) => item.type === 'tool').length).toBeGreaterThanOrEqual(3);
  });
});

describe('parseThinkingTurnLayout Claude weak tool dedup', () => {
  it('preserves multiple weak-id tools with the same name but different inputs', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'exec', name: 'exec', input: { cmd: 'a' } },
          { type: 'tool_use', id: 'exec', name: 'exec', input: { cmd: 'b' } },
          { type: 'tool_use', id: 'exec', name: 'exec', input: { cmd: 'c' } },
        ],
      },
    ];

    const done = parseThinkingTurnLayout(messages, {
      isLiveStream: false,
      engineProfile: 'claude',
    });
    const group = done.segments.find((segment) => segment.kind === 'tool-group');
    expect(
      group?.kind === 'tool-group'
        && group.timeline.filter((item) => item.type === 'tool').length,
    ).toBe(3);
  });
});

describe('shouldSkipDoneSegmentNormalize', () => {
  it('skips proportional split for single monolithic tool-group', () => {
    const segments = [
      { kind: 'phase-text' as const, key: 'opening', text: '旁白 A' },
      { kind: 'phase-text' as const, key: 'phase-text-after-0', text: '旁白 B' },
      {
        kind: 'tool-group' as const,
        key: 'tool-group-batch-0',
        timeline: [
          { type: 'tool', index: 1, id: 't1', name: 'exec', input: {} },
          { type: 'tool', index: 2, id: 't2', name: 'exec', input: {} },
        ],
        state: 'completed' as const,
      },
    ];

    expect(shouldSkipDoneSegmentNormalize(segments)).toBe(false);
  });
});
