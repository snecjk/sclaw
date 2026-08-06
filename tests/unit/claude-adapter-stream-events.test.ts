import { describe, expect, it } from 'vitest';
import { consumeClaudeQuery } from '../../electron/engines/claude-adapter';
import type { LegacyChatMessagePayload } from '../../electron/gateway/normalized-engine-event';

function createQuery(messages: Array<Record<string, unknown>>) {
  return {
    close() {},
    async *[Symbol.asyncIterator]() {
      for (const message of messages) yield message;
    },
  };
}

function createSink() {
  const chatEvents: LegacyChatMessagePayload[] = [];
  return {
    chatEvents,
    sink: {
      emit(event: string, payload: unknown) {
        if (event === 'chat:message') {
          chatEvents.push(payload as LegacyChatMessagePayload);
        }
        return true;
      },
    },
  };
}

describe('consumeClaudeQuery stream projection', () => {
  it('emits one canonical delta for each text fragment', async () => {
    const { chatEvents, sink } = createSink();
    await consumeClaudeQuery(
      'agent:test:session:text',
      'session-text',
      'D:\\workspace',
      createQuery([
        { type: 'stream_event', event: { type: 'message_start' } },
        {
          type: 'stream_event',
          event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
        },
        {
          type: 'stream_event',
          event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
        },
      ]),
      sink,
      'run-text',
    );

    const deltas = chatEvents.filter((event) => event.engineEvent.type === 'message.delta');
    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.engineEvent).toMatchObject({
      type: 'message.delta',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'hello' }],
      },
    });
  });

  it('keeps the real tool id, streams partial input, and emits completion', async () => {
    const { chatEvents, sink } = createSink();
    await consumeClaudeQuery(
      'agent:test:session:tool',
      'session-tool',
      'D:\\workspace',
      createQuery([
        { type: 'stream_event', event: { type: 'message_start' } },
        {
          type: 'stream_event',
          event: {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'tool_use', id: 'toolu_real', name: 'Bash' },
          },
        },
        {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: '{"command":' },
          },
        },
        {
          type: 'user',
          uuid: 'tool-result-message',
          message: {
            content: [{ type: 'tool_result', tool_use_id: 'toolu_real', content: 'ok' }],
          },
        },
      ]),
      sink,
      'run-tool',
    );

    const deltas = chatEvents.filter((event) => event.engineEvent.type === 'message.delta');
    expect(deltas.at(-1)?.engineEvent).toMatchObject({
      type: 'message.delta',
      message: {
        content: [{ type: 'tool_use', id: 'toolu_real', name: 'Bash', input: '{"command":' }],
      },
    });
    expect(chatEvents.find((event) => event.engineEvent.type === 'tool.result')?.engineEvent).toMatchObject({
      type: 'tool.result',
      message: {
        role: 'toolresult',
        toolCallId: 'toolu_real',
        toolName: 'Bash',
        content: 'ok',
        status: 'completed',
      },
    });
  });

  it('coalesces a burst of tool input fragments and flushes on block stop', async () => {
    const { chatEvents, sink } = createSink();
    const fragments = Array.from({ length: 2_000 }, () => ({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: 'x' },
      },
    }));
    await consumeClaudeQuery(
      'agent:test:session:tool-burst',
      'session-tool-burst',
      'D:\\workspace',
      createQuery([
        { type: 'stream_event', event: { type: 'message_start' } },
        {
          type: 'stream_event',
          event: {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'tool_use', id: 'toolu_burst', name: 'Write' },
          },
        },
        ...fragments,
        { type: 'stream_event', event: { type: 'content_block_stop', index: 0 } },
      ]),
      sink,
      'run-tool-burst',
    );

    const deltas = chatEvents.filter((event) => event.engineEvent.type === 'message.delta');
    // One tool-start snapshot plus at most the leading/trailing coalesced input snapshots.
    expect(deltas.length).toBeLessThanOrEqual(3);
    const lastMessage = deltas.at(-1)?.engineEvent;
    expect(lastMessage).toMatchObject({
      type: 'message.delta',
      message: { content: [{ type: 'tool_use', id: 'toolu_burst', name: 'Write' }] },
    });
    if (lastMessage?.type === 'message.delta') {
      const content = (lastMessage.message as { content: Array<{ input?: unknown }> }).content;
      expect(String(content[0]?.input).length).toBeLessThanOrEqual(4_096);
    }
  });
});
