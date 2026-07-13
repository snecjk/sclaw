import { describe, expect, it } from 'vitest';
import {
  extractStreamingToolsFromToolResults,
  extractStreamingToolsFromTurnMessages,
  resolveDoneTurnStreamingTools,
} from '@/lib/thinking-done-tools';
import { writeTurnStreamingToolsCache } from '@/lib/thinking-turn-tools-cache';
import { parseThinkingTurnLayout } from '@/pages/Chat/thinking-turn-segments';

describe('thinking-done-tools', () => {
  it('extracts tools from assistant snapshots', () => {
    const tools = extractStreamingToolsFromTurnMessages([
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'plan' },
          { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'curl' } },
        ],
      },
    ]);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('Bash');
  });

  it('extracts tools from cached tool_result rows', () => {
    const tools = extractStreamingToolsFromToolResults([
      {
        role: 'toolresult',
        toolCallId: 'toolu_2',
        toolName: 'web_search',
        content: 'ok',
      },
    ]);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('web_search');
  });

  it('falls back to tool_result when cache and snapshots are empty', () => {
    const tools = resolveDoneTurnStreamingTools({
      turnStableKey: 'missing-key',
      turnMessages: [
        {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'only thinking after reload' }],
        },
      ],
      toolResults: [
        {
          role: 'toolresult',
          toolCallId: 'toolu_x',
          toolName: 'Bash',
          content: 'done',
        },
      ],
    });
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('Bash');
  });

  it('merges assistant message input over cache placeholder for same toolCallId', () => {
    writeTurnStreamingToolsCache('turn-user-u1', [
      { toolCallId: 'toolu_cached', name: 'Bash', status: 'completed' },
    ]);
    const tools = resolveDoneTurnStreamingTools({
      turnStableKey: 'turn-user-u1',
      turnMessages: [
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_cached', name: 'Bash', input: { command: 'curl wttr.in' } },
          ],
        },
      ],
      toolResults: [],
    });
    expect(tools).toHaveLength(1);
    expect(tools[0]?.input).toEqual({ command: 'curl wttr.in' });
  });

  it('still reads cache-only tools when messages are empty', () => {
    writeTurnStreamingToolsCache('turn-cache-only', [
      { toolCallId: 'toolu_cached', name: 'exec', input: { cmd: 'ls' }, status: 'completed' },
    ]);
    const tools = resolveDoneTurnStreamingTools({
      turnStableKey: 'turn-cache-only',
      turnMessages: [],
      toolResults: [],
    });
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('exec');
  });
});

describe('parseThinkingTurnLayout Claude done tool fallback', () => {
  it('injects tools from streamingTools when done parse only has thinking', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '我来查天气。' },
          { type: 'thinking', thinking: '先调用 Bash 查 wttr.in' },
        ],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '明天上海晴，18°C。' }],
      },
    ];

    const done = parseThinkingTurnLayout(messages, {
      isLiveStream: false,
      engineProfile: 'claude',
      streamingTools: [
        { toolCallId: 'toolu_1', name: 'Bash', input: { command: 'curl wttr.in' }, status: 'completed' },
        { toolCallId: 'toolu_2', name: 'web_search', input: { q: 'weather' }, status: 'completed' },
      ],
    });

    const toolCount = done.segments
      .filter((segment) => segment.kind === 'tool-group')
      .reduce(
        (count, group) => count + group.timeline.filter((item) => item.type === 'tool').length,
        0,
      );
    expect(toolCount).toBeGreaterThanOrEqual(2);
  });
});
