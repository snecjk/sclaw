import { describe, expect, it } from 'vitest';
import {
  appendTurnToolResultCache,
  readTurnStreamingToolsCache,
  readTurnToolResultsCache,
  writeTurnStreamingToolsCache,
} from '@/lib/thinking-turn-tools-cache';
import {
  buildChronologicalFallbackEntries,
  resolveTurnChronologicalEntries,
} from '@/pages/Chat/chat-display';
import { parseThinkingTurnLayout } from '@/pages/Chat/thinking-turn-segments';

describe('thinking-turn-tools-cache', () => {
  it('persists streamingTools and tool_results by turnStableKey across reads', () => {
    const key = 'turn-test-cache';
    writeTurnStreamingToolsCache(key, [
      { toolCallId: 'toolu_1', name: 'Bash', input: { command: 'curl wttr.in' }, status: 'completed' },
      { toolCallId: 'toolu_2', name: 'web_search', input: { q: 'weather' }, status: 'completed' },
    ]);
    appendTurnToolResultCache(key, {
      role: 'toolresult',
      toolCallId: 'toolu_1',
      toolName: 'Bash',
      content: 'ok',
    });

    expect(readTurnStreamingToolsCache(key)).toHaveLength(2);
    expect(readTurnToolResultsCache(key)).toHaveLength(1);
  });

  it('reads cache via alias key when primary key drifted', () => {
    const userKey = 'turn-user-u1';
    const legacyKey = 'turn-3-snap-old-id';
    writeTurnStreamingToolsCache(userKey, [
      { toolCallId: 'toolu_x', name: 'Bash', status: 'completed' },
    ]);

    expect(readTurnStreamingToolsCache(legacyKey, [userKey])).toHaveLength(1);
    expect(readTurnStreamingToolsCache(legacyKey)).toHaveLength(0);
  });
});

describe('resolveTurnChronologicalEntries', () => {
  it('falls back to cached tool_results when session messages have none', () => {
    const user = { id: 'u1', role: 'user', content: '查天气' };
    const snap1 = {
      id: 's1',
      role: 'assistant',
      content: [
        { type: 'text', text: '我来查询。' },
        { type: 'thinking', thinking: 'plan' },
      ],
    };
    const snap2 = {
      id: 's2',
      role: 'assistant',
      content: [{ type: 'text', text: '最终表格' }],
    };
    const sessionMessages = [user, snap1, snap2];
    const toolResults = [
      {
        role: 'toolresult',
        toolCallId: 'toolu_1',
        toolName: 'Bash',
        content: 'ok',
      },
    ];

    const entries = resolveTurnChronologicalEntries(
      sessionMessages,
      user,
      [snap1, snap2],
      toolResults,
    );

    expect(entries.some((entry) => entry.kind === 'tool-result')).toBe(true);

    const done = parseThinkingTurnLayout([snap1, snap2], {
      isLiveStream: false,
      engineProfile: 'claude',
      chronologicalEntries: entries,
      streamingTools: readTurnStreamingToolsCache('unused'),
    });

    const toolCount = done.segments
      .filter((segment) => segment.kind === 'tool-group')
      .reduce(
        (count, group) =>
          count + group.timeline.filter((item) => item.type === 'tool').length,
        0,
      );
    expect(toolCount).toBeGreaterThanOrEqual(1);
  });

  it('interleaves assistant snapshots with cached tool results', () => {
    const assistants = [
      { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'phase 1' }] },
      { id: 'a2', role: 'assistant', content: [{ type: 'text', text: 'phase 2' }] },
      { id: 'a3', role: 'assistant', content: [{ type: 'text', text: 'final' }] },
    ];
    const toolResults = [
      { role: 'toolresult', toolCallId: 't1', toolName: 'exec', content: '1' },
      { role: 'toolresult', toolCallId: 't2', toolName: 'exec', content: '2' },
    ];

    const entries = buildChronologicalFallbackEntries(assistants, toolResults);
    expect(entries.map((entry) => entry.kind)).toEqual([
      'assistant',
      'tool-result',
      'assistant',
      'tool-result',
      'assistant',
    ]);
  });
});
