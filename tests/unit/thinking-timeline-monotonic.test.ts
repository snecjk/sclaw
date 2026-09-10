import { describe, expect, it } from 'vitest';
import {
  mergeTimelineMonotonic,
  timelineBlockResetKey,
} from '../../src/lib/thinking-timeline-active';
import type { ThinkingTimelineItem } from '../../src/pages/Chat/message-utils';

describe('timelineBlockResetKey', () => {
  it('keeps stable key for thinking content when index changes after rebundle', () => {
    const content = 'The user wants a weather analysis report for Shanghai.';
    const item: ThinkingTimelineItem = { type: 'thinking', content };
    const keyAt0 = timelineBlockResetKey(item, 0);
    const keyAt3 = timelineBlockResetKey(item, 3);
    expect(keyAt0).toBe(keyAt3);
  });
});

describe('mergeTimelineMonotonic', () => {
  it('replaces a growing Claude thinking snapshot instead of duplicating it', () => {
    const cached: ThinkingTimelineItem[] = [
      { type: 'thinking', content: 'The' },
    ];
    const incoming: ThinkingTimelineItem[] = [
      { type: 'thinking', content: 'The user wants me to create a skill.' },
    ];

    expect(mergeTimelineMonotonic(cached, incoming)).toEqual(incoming);
  });

  it('keeps the longer thinking snapshot when an incoming parse temporarily shrinks', () => {
    const cached: ThinkingTimelineItem[] = [
      { type: 'thinking', content: 'The user wants me to create a skill.' },
    ];
    const incoming: ThinkingTimelineItem[] = [
      { type: 'thinking', content: 'The user' },
    ];

    expect(mergeTimelineMonotonic(cached, incoming)).toEqual(cached);
  });

  it('preserves cached order when incoming rebundles same items', () => {
    const thinkA: ThinkingTimelineItem = { type: 'thinking', content: 'alpha thinking block' };
    const toolA: ThinkingTimelineItem = {
      type: 'tool',
      index: 1,
      id: 't1',
      name: 'exec',
      input: {},
    };
    const thinkB: ThinkingTimelineItem = { type: 'thinking', content: 'beta thinking block' };

    const cached = [thinkA, toolA, thinkB];
    const incoming = [thinkB, toolA, thinkA];

    const merged = mergeTimelineMonotonic(cached, incoming);
    expect(merged).toHaveLength(3);
    expect(merged[0]).toMatchObject({ type: 'thinking', content: 'alpha thinking block' });
    expect(merged[1]).toMatchObject({ type: 'tool', id: 't1' });
    expect(merged[2]).toMatchObject({ type: 'thinking', content: 'beta thinking block' });
  });

  it('keeps a live thinking block when the collapsed tail window slides', () => {
    const parts = ['abcdefghij'.repeat(20)];
    const cached: ThinkingTimelineItem[] = [
      { type: 'thinking', content: 'abcdefghij'.repeat(8), liveParts: parts },
    ];
    const incoming: ThinkingTimelineItem[] = [
      { type: 'thinking', content: 'cdefghijab'.repeat(8), liveParts: parts },
    ];

    const merged = mergeTimelineMonotonic(cached, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ type: 'thinking', liveParts: parts });
    expect(timelineBlockResetKey(cached[0]!, 0)).toBe(timelineBlockResetKey(incoming[0]!, 0));
  });

  it('does not shrink timeline when incoming is shorter', () => {
    const cached: ThinkingTimelineItem[] = [
      { type: 'thinking', content: 'a' },
      { type: 'tool', index: 1, id: 't1', name: 'exec', input: {} },
      { type: 'thinking', content: 'b' },
    ];
    const incoming: ThinkingTimelineItem[] = [
      { type: 'thinking', content: 'a' },
      { type: 'tool', index: 1, id: 't1', name: 'exec', input: {} },
    ];

    expect(mergeTimelineMonotonic(cached, incoming)).toHaveLength(3);
  });
});
