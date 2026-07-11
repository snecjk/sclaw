import { describe, expect, it } from 'vitest';
import {
  reduceTurnParts,
  buildToolPartLookup,
} from '@/pages/Chat/thinking/turn-part-reducer';
import { applyTurnPartsToParsedTurn } from '@/pages/Chat/thinking/turn-part-adapter';
import type { RawTurnEvent } from '@/pages/Chat/thinking/types';

describe('reduceTurnParts', () => {
  it('merges duplicate stable tool identity and preserves richer input', () => {
    const events: RawTurnEvent[] = [
      { type: 'tool', id: 'toolu_abc', name: 'exec', input: null },
      { type: 'tool', id: 'toolu_abc', name: 'exec', input: { cmd: 'ls' } },
    ];

    const parts = reduceTurnParts(events, { isLiveStream: false });
    const tools = parts.filter((part) => part.kind === 'tool_call');

    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      kind: 'tool_call',
      name: 'exec',
      input: { cmd: 'ls' },
      inputState: 'complete',
    });
  });

  it('supplements streamingTools without duplicating stable identity', () => {
    const events: RawTurnEvent[] = [
      { type: 'tool', id: 'toolu_abc', name: 'web_search', input: null },
    ];

    const parts = reduceTurnParts(events, {
      isLiveStream: true,
      streamingTools: [
        { toolCallId: 'toolu_abc', name: 'web_search', input: { q: 'weather' }, status: 'running' },
      ],
    });

    const lookup = buildToolPartLookup(parts);
    expect(lookup.get('toolu_abc')?.input).toEqual({ q: 'weather' });
  });
});

describe('applyTurnPartsToParsedTurn', () => {
  it('dedupes timeline tools by identity and enriches input', () => {
    const layout = {
      segments: [
        {
          kind: 'tool-group' as const,
          key: 'group-0',
          state: 'completed' as const,
          timeline: [
            { type: 'tool' as const, index: 1, id: 'toolu_abc', name: 'exec', input: null },
            { type: 'tool' as const, index: 2, id: 'toolu_abc', name: 'exec', input: { cmd: 'a' } },
          ],
        },
      ],
      finalReplyText: null,
    };

    const parts = reduceTurnParts(
      [{ type: 'tool', id: 'toolu_abc', name: 'exec', input: { cmd: 'a' } }],
      { isLiveStream: false },
    );

    const enriched = applyTurnPartsToParsedTurn(layout, parts);
    const group = enriched.segments[0];
    expect(group?.kind).toBe('tool-group');
    if (group?.kind !== 'tool-group') return;

    const tools = group.timeline.filter((item) => item.type === 'tool');
    expect(tools).toHaveLength(1);
    expect(tools[0]?.input).toEqual({ cmd: 'a' });
  });
});
