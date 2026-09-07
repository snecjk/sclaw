import { describe, expect, it, vi } from 'vitest';
import { consumeClaudeQuery } from '../../electron/engines/claude-adapter';
import type { LegacyChatMessagePayload } from '../../electron/gateway/normalized-engine-event';

vi.mock('../../electron/engines/session-registry', () => ({
  deleteEngineSessionRegistryEntry: vi.fn(),
  getEngineSessionRegistryEntry: vi.fn(async () => null),
  listEngineSessionRegistryEntries: vi.fn(async () => []),
  patchEngineSessionRegistryEntry: vi.fn(),
  upsertEngineSessionRegistryEntry: vi.fn(),
}));

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
  const notifications: Array<Record<string, unknown>> = [];
  const emissions: Array<{ event: string; payload: unknown }> = [];
  return {
    chatEvents,
    notifications,
    emissions,
    sink: {
      emit(event: string, payload: unknown) {
        emissions.push({ event, payload });
        if (event === 'chat:message') {
          chatEvents.push(payload as LegacyChatMessagePayload);
        } else if (event === 'notification') {
          notifications.push(payload as Record<string, unknown>);
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

  it('keeps the run active until background subagents and the resumed main turn finish', async () => {
    const { chatEvents, notifications, emissions, sink } = createSink();
    await consumeClaudeQuery(
      'agent:test:session:subagents',
      'session-subagents',
      'D:\\workspace',
      createQuery([
        {
          type: 'system',
          subtype: 'task_started',
          task_id: 'task-child',
          session_id: 'session-subagents',
        },
        {
          type: 'result',
          subtype: 'success',
          session_id: 'session-subagents',
          result: 'Waiting for the child agent.',
        },
        {
          type: 'system',
          subtype: 'task_notification',
          task_id: 'task-child',
          status: 'completed',
          session_id: 'session-subagents',
        },
        {
          type: 'assistant',
          uuid: 'resumed-main-message',
          session_id: 'session-subagents',
          origin: { kind: 'auto-continuation' },
          message: { content: [{ type: 'text', text: 'Child result merged.' }] },
        },
        {
          type: 'result',
          subtype: 'success',
          session_id: 'session-subagents',
          origin: { kind: 'auto-continuation' },
          result: 'Done.',
        },
      ]),
      sink,
      'run-subagents',
    );

    expect(chatEvents.some((event) => (
      event.engineEvent.type === 'message.final'
      && (event.engineEvent.message as { id?: string }).id === 'resumed-main-message'
    ))).toBe(true);
    expect(notifications).toEqual([
      {
        method: 'agent',
        params: {
          phase: 'completed',
          runId: 'run-subagents',
          sessionKey: 'agent:test:session:subagents',
        },
      },
    ]);
    const resumedMessageIndex = emissions.findIndex(({ event, payload }) => (
      event === 'chat:message'
      && (payload as LegacyChatMessagePayload).engineEvent.type === 'message.final'
      && ((payload as LegacyChatMessagePayload).engineEvent.message as { id?: string }).id === 'resumed-main-message'
    ));
    const completionIndex = emissions.findIndex(({ event }) => event === 'notification');
    expect(resumedMessageIndex).toBeGreaterThan(-1);
    expect(completionIndex).toBeGreaterThan(resumedMessageIndex);
  });

  it('still completes a normal main-agent-only result immediately', async () => {
    const { notifications, sink } = createSink();
    await consumeClaudeQuery(
      'agent:test:session:main-only',
      'session-main-only',
      'D:\\workspace',
      createQuery([
        {
          type: 'result',
          subtype: 'success',
          session_id: 'session-main-only',
          result: 'Done.',
        },
      ]),
      sink,
      'run-main-only',
    );

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      params: { phase: 'completed', runId: 'run-main-only' },
    });
  });

  it('does not keep the chat run open for ambient SDK housekeeping tasks', async () => {
    const { notifications, sink } = createSink();
    await consumeClaudeQuery(
      'agent:test:session:ambient-task',
      'session-ambient-task',
      'D:\\workspace',
      createQuery([
        {
          type: 'system',
          subtype: 'task_started',
          task_id: 'task-housekeeping',
          skip_transcript: true,
          session_id: 'session-ambient-task',
        },
        {
          type: 'result',
          subtype: 'success',
          session_id: 'session-ambient-task',
          result: 'Done.',
        },
      ]),
      sink,
      'run-ambient-task',
    );

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      params: { phase: 'completed', runId: 'run-ambient-task' },
    });
  });

  it('does not auto-resume a control-line / thinking-only result', async () => {
    const { notifications, sink } = createSink();
    const outcome = await consumeClaudeQuery(
      'agent:test:session:contentless',
      'session-contentless',
      'D:\\workspace',
      createQuery([
        {
          type: 'assistant',
          uuid: 'control-line',
          message: { content: [{ type: 'text', text: 'No response requested.' }] },
        },
        {
          type: 'result',
          subtype: 'success',
          session_id: 'session-contentless',
          result: 'No response requested.',
        },
      ]),
      sink,
      'run-contentless',
    );

    expect(outcome.autoResume).toBe(false);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      params: { phase: 'completed', runId: 'run-contentless' },
    });
  });
});
