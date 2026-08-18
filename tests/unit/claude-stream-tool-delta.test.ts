import { describe, expect, it } from 'vitest';
import {
  applyClaudeStreamEvent,
  ClaudeStreamContentAccumulator,
  extractClaudeToolResultMessages,
} from '../../electron/engines/claude-stream-content';
import {
  appendStreamingExtrasToTimeline,
  shouldAppendStreamingExtraTool,
} from '../../src/lib/thinking-timeline-active';
import { collectToolUpdates, upsertToolStatuses } from '../../src/stores/chat/helpers';

describe('upsertToolStatuses input preservation', () => {
  it('does not overwrite existing input with null from later updates', () => {
    const current = [
      {
        toolCallId: 'toolu_1',
        name: 'exec',
        status: 'running' as const,
        input: { command: 'ls' },
        updatedAt: 1,
      },
    ];
    const updates = collectToolUpdates(
      {
        role: 'toolresult',
        toolCallId: 'toolu_1',
        toolName: 'exec',
        content: 'ok',
        status: 'completed',
      },
      'final',
    );

    const next = upsertToolStatuses(current, updates);
    expect(next[0]?.input).toEqual({ command: 'ls' });
    expect(next[0]?.status).toBe('completed');
  });

  it('extracts tool_use input from assistant final messages', () => {
    const updates = collectToolUpdates(
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_2', name: 'Bash', input: { command: 'pwd' } },
        ],
      },
      'final',
    );

    expect(updates.some((tool) => tool.toolCallId === 'toolu_2' && tool.input)).toBe(true);
  });

  it('upgrades tool input when later tool_use carries params for same id', () => {
    const first = collectToolUpdates(
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_3', name: 'Bash', input: {} }],
      },
      'delta',
    );
    let tools = upsertToolStatuses([], first);
    const second = collectToolUpdates(
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_3', name: 'Bash', input: { command: 'ls -la' } },
        ],
      },
      'final',
    );
    tools = upsertToolStatuses(tools, second);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.input).toEqual({ command: 'ls -la' });
  });
});

describe('shouldAppendStreamingExtraTool', () => {
  it('allows running tools without input (awaiting params)', () => {
    expect(shouldAppendStreamingExtraTool({ name: 'exec', status: 'running' })).toBe(true);
  });

  it('allows completed tools with stable id even without input', () => {
    expect(
      shouldAppendStreamingExtraTool({
        toolCallId: 'toolu_1',
        name: 'exec',
        status: 'completed',
        input: null,
      }),
    ).toBe(true);
  });

  it('skips completed weak-id tools without input', () => {
    expect(
      shouldAppendStreamingExtraTool({
        id: 'exec',
        name: 'exec',
        status: 'completed',
        input: null,
      }),
    ).toBe(false);
  });

  it('allows completed tools with input', () => {
    expect(
      shouldAppendStreamingExtraTool({
        toolCallId: 'toolu_1',
        name: 'exec',
        status: 'completed',
        input: { command: 'ls' },
      }),
    ).toBe(true);
  });
});

describe('appendStreamingExtrasToTimeline null-input guard', () => {
  it('appends stable-id completed tools but skips weak-id completed without input', () => {
    const merged = appendStreamingExtrasToTimeline(
      [{ type: 'thinking', content: 'plan' }],
      [
        { toolCallId: 'toolu_a', name: 'exec', status: 'completed', input: null },
        { id: 'exec', name: 'exec', status: 'completed', input: null },
        { toolCallId: 'toolu_c', name: 'exec', status: 'running', input: null },
        { toolCallId: 'toolu_d', name: 'read', status: 'completed', input: { path: 'a.md' } },
      ],
    );

    const tools = merged.filter((item) => item.type === 'tool');
    expect(tools).toHaveLength(3);
    expect(tools.map((item) => item.type === 'tool' && item.id)).toEqual([
      'toolu_a',
      'toolu_c',
      'toolu_d',
    ]);
  });
});

describe('ClaudeStreamContentAccumulator', () => {
  it('keeps partial JSON visible until the complete input can be parsed', () => {
    const acc = new ClaudeStreamContentAccumulator();
    applyClaudeStreamEvent(acc, {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'toolu_partial', name: 'Bash' },
    });
    applyClaudeStreamEvent(acc, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"command":' },
    });

    expect(acc.buildContentArray()).toEqual([{
      type: 'tool_use',
      id: 'toolu_partial',
      name: 'Bash',
      input: '{"command":',
    }]);
  });

  it('caps large partial JSON previews without losing the accumulated final input', () => {
    const acc = new ClaudeStreamContentAccumulator();
    const content = 'x'.repeat(10_000);
    applyClaudeStreamEvent(acc, {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'toolu_large', name: 'Write' },
    });
    applyClaudeStreamEvent(acc, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: `{"content":"${content}` },
    });

    const partial = acc.buildContentArray({ maxPartialInputChars: 512 });
    expect(String(partial[0]?.input).length).toBeLessThanOrEqual(512);
    expect(String(partial[0]?.input)).toContain('partial tool input:');

    applyClaudeStreamEvent(acc, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '"}' },
    });
    expect(acc.buildContentArray()[0]?.input).toEqual({ content });
  });

  it('accumulates tool_use input_json_delta into content blocks', () => {
    const acc = new ClaudeStreamContentAccumulator();

    applyClaudeStreamEvent(acc, {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'toolu_x', name: 'Bash' },
    });
    applyClaudeStreamEvent(acc, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"command":' },
    });
    applyClaudeStreamEvent(acc, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '"ls -la"}' },
    });

    expect(acc.buildContentArray()).toEqual([
      {
        type: 'tool_use',
        id: 'toolu_x',
        name: 'Bash',
        input: { command: 'ls -la' },
      },
    ]);
  });

  it('interleaves text and tool blocks by index', () => {
    const acc = new ClaudeStreamContentAccumulator();

    applyClaudeStreamEvent(acc, {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text' },
    });
    applyClaudeStreamEvent(acc, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Checking…' },
    });
    applyClaudeStreamEvent(acc, {
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'tool_use', id: 'toolu_y', name: 'exec' },
    });
    applyClaudeStreamEvent(acc, {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'input_json_delta', partial_json: '{"cmd":"pwd"}' },
    });

    expect(acc.buildContentArray()).toEqual([
      { type: 'text', text: 'Checking…' },
      { type: 'tool_use', id: 'toolu_y', name: 'exec', input: { cmd: 'pwd' } },
    ]);
  });

  it('resets on message_start', () => {
    const acc = new ClaudeStreamContentAccumulator();
    applyClaudeStreamEvent(acc, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'hello' },
    });
    applyClaudeStreamEvent(acc, { type: 'message_start' });
    expect(acc.buildContentArray()).toEqual([]);
  });
});

describe('extractClaudeToolResultMessages', () => {
  it('converts hidden SDK tool_result blocks into canonical completion updates', () => {
    const names = new Map([['toolu_ok', 'Bash'], ['toolu_error', 'Read']]);
    expect(extractClaudeToolResultMessages({
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_ok', content: 'done' },
        { type: 'tool_result', tool_use_id: 'toolu_error', content: [{ type: 'text', text: 'denied' }], is_error: true },
      ],
    }, names)).toEqual([
      {
        role: 'toolresult',
        toolCallId: 'toolu_ok',
        toolName: 'Bash',
        content: 'done',
        status: 'completed',
      },
      {
        role: 'toolresult',
        toolCallId: 'toolu_error',
        toolName: 'Read',
        content: 'denied',
        status: 'error',
      },
    ]);
  });
});
