import { describe, expect, it } from 'vitest';
import { readOpenAiChatCompletionSse } from '@electron/services/openai-chat-completion-sse';

const encoder = new TextEncoder();

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe('readOpenAiChatCompletionSse', () => {
  it('assembles delta content across transport chunk boundaries', async () => {
    const chunks: unknown[] = [];
    const events: unknown[] = [];
    const body = streamFrom([
      'data: {"choices":[{"index":0,"delta":{"content":"你',
      '好"}}]}\r\n\r\ndata: {"choices":[],"usage":{"total_tokens":3}}\n\n',
      'data: [DONE]\n\n',
    ]);

    await expect(readOpenAiChatCompletionSse(body, {
      idleTimeoutMs: 1_000,
      totalTimeoutMs: 5_000,
      onChunk: (progress) => chunks.push(progress),
      onEvent: (progress) => events.push(progress),
    })).resolves.toBe('你好');
    expect(chunks).toHaveLength(3);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ done: false, contentLength: 2, assistantTextLength: 2 }),
      expect.objectContaining({ done: true, assistantTextLength: 2 }),
    ]));
  });

  it('rejects a stream that closes without the DONE marker', async () => {
    const body = streamFrom(['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n']);

    await expect(readOpenAiChatCompletionSse(body, {
      idleTimeoutMs: 1_000,
      totalTimeoutMs: 5_000,
    })).rejects.toThrow('未收到 [DONE]');
  });

  it('rejects invalid event JSON', async () => {
    const body = streamFrom(['data: {invalid}\n\ndata: [DONE]\n\n']);

    await expect(readOpenAiChatCompletionSse(body, {
      idleTimeoutMs: 1_000,
      totalTimeoutMs: 5_000,
    })).rejects.toThrow('无效 JSON');
  });

  it('rejects when the stream remains idle', async () => {
    const body = new ReadableStream<Uint8Array>();

    await expect(readOpenAiChatCompletionSse(body, {
      idleTimeoutMs: 5,
      totalTimeoutMs: 100,
    })).rejects.toThrow('无数据');
  });
});
