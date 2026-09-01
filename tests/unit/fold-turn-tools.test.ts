import { describe, expect, it } from 'vitest';
import {
  foldThinkingTimelineTools,
  foldToolList,
  resolveTurnToolCount,
} from '@/pages/Chat/thinking/fold-turn-tools';
import type { ThinkingTimelineItem } from '@/pages/Chat/message-utils';

function tool(id: string): ThinkingTimelineItem {
  return { type: 'tool', index: 0, id, name: id, input: {} };
}

describe('foldToolList', () => {
  it('keeps the last 10 tools and reports the rest as hidden', () => {
    const tools = Array.from({ length: 15 }, (_, index) => ({ id: `t${index}` }));
    const folded = foldToolList(tools);
    expect(folded.visible.map((item) => item.id)).toEqual(
      ['t5', 't6', 't7', 't8', 't9', 't10', 't11', 't12', 't13', 't14'],
    );
    expect(folded.hiddenToolCount).toBe(5);
    expect(folded.totalToolCount).toBe(15);
  });
});

describe('foldThinkingTimelineTools', () => {
  it('keeps non-tool rows and only the last 10 tool cards', () => {
    const timeline: ThinkingTimelineItem[] = [
      { type: 'thinking', content: 'plan' },
      ...Array.from({ length: 12 }, (_, index) => tool(`t${index}`)),
      { type: 'narration', content: 'done' },
    ];
    const folded = foldThinkingTimelineTools(timeline);
    expect(folded.hiddenToolCount).toBe(2);
    expect(folded.visible.filter((item) => item.type === 'tool')).toHaveLength(10);
    expect(folded.visible[0]).toEqual({ type: 'thinking', content: 'plan' });
    expect(folded.visible[folded.visible.length - 1]).toEqual({ type: 'narration', content: 'done' });
  });
});

describe('resolveTurnToolCount', () => {
  it('uses the monotonic run count when the overlay window is smaller', () => {
    expect(resolveTurnToolCount(200, 80)).toBe(200);
    expect(resolveTurnToolCount(8, 10)).toBe(10);
  });
});
