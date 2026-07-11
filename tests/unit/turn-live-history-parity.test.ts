import { describe, expect, it } from 'vitest';
import { parseThinkingTurnLayout } from '@/pages/Chat/thinking-turn-segments';
import { groupTurnParts } from '@/pages/Chat/thinking/turn-part-groups';
import { reduceTurnParts } from '@/pages/Chat/thinking/turn-part-reducer';
import { buildMergedRawTurnEvents } from '@/pages/Chat/thinking-turn-segments';

function segmentKinds(segments: ReturnType<typeof parseThinkingTurnLayout>['segments']): string[] {
  return segments.map((segment) => segment.kind);
}

function buildTextToolInterleaveFixture() {
  const narrations = [
    'Now let me read the config first.',
    'Let me search for a matching skill.',
    'Next, I will query the metrics.',
  ];
  const makeBatch = (toolId: string, thinking: string) => [
    { type: 'thinking' as const, thinking },
    { type: 'tool_use' as const, id: toolId, name: 'read', input: {} },
  ];

  let cumulative: Array<Record<string, unknown>> = [];
  const messages: Array<{ role: string; content: Array<Record<string, unknown>> }> = [];
  for (let index = 0; index < 3; index += 1) {
    cumulative = [...cumulative, ...makeBatch(`t${index}`, `step ${index + 1}`)];
    messages.push({ role: 'assistant', content: [...cumulative] });
    cumulative = [...cumulative, { type: 'text', text: narrations[index] }];
    messages.push({ role: 'assistant', content: [...cumulative] });
  }

  return { messages, narrations };
}

describe('live/history turn layout parity (§5.4 / Phase 2)', () => {
  it('live and done produce the same segment kind sequence for text→tool→text interleave', () => {
    const { messages } = buildTextToolInterleaveFixture();

    const live = parseThinkingTurnLayout(messages, {
      isLiveStream: true,
      engineProfile: 'openclaw',
    });
    const done = parseThinkingTurnLayout(messages, {
      isLiveStream: false,
      engineProfile: 'openclaw',
    });

    expect(segmentKinds(live.segments)).toEqual(segmentKinds(done.segments));
    expect(live.segments.filter((s) => s.kind === 'tool-group').length).toBe(3);
    expect(live.segments.filter((s) => s.kind === 'phase-text').length).toBeGreaterThanOrEqual(2);
  });

  it('live and history TurnPart group boundaries match for the same fixture', () => {
    const { messages } = buildTextToolInterleaveFixture();

    const liveEvents = buildMergedRawTurnEvents(messages, { isLiveStream: true });
    const historyEvents = buildMergedRawTurnEvents(messages, { isLiveStream: false });

    const liveParts = reduceTurnParts(liveEvents, { isLiveStream: true });
    const historyParts = reduceTurnParts(historyEvents, { isLiveStream: false });

    const liveGroups = groupTurnParts(liveParts);
    const historyGroups = groupTurnParts(historyParts);

    expect(liveGroups.map((g) => ('key' in g ? g.key : g.kind))).toEqual(
      historyGroups.map((g) => ('key' in g ? g.key : g.kind)),
    );
  });

  it('English planning narration stays in phase-text, not final reply', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'plan' },
          { type: 'tool_use', id: 't0', name: 'search', input: {} },
          { type: 'text', text: 'Now let me query the database for last week.' },
          { type: 'text', text: '## Weekly Report\n\nHere is the summary.' },
        ],
      },
    ];

    const layout = parseThinkingTurnLayout(messages, {
      isLiveStream: true,
      engineProfile: 'openclaw',
    });

    expect(layout.finalReplyText?.includes('Now let me query')).toBe(false);
    expect(layout.finalReplyText?.includes('Weekly Report')).toBe(true);
  });
});
