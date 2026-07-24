import { beforeEach, describe, expect, it, vi } from 'vitest';

const proxyAwareFetchMock = vi.hoisted(() => vi.fn());

vi.mock('@electron/utils/proxy-fetch', () => ({
  proxyAwareFetch: (...args: unknown[]) => proxyAwareFetchMock(...args),
}));

vi.mock('@electron/utils/auth-store', () => ({
  getStoToken: vi.fn().mockResolvedValue('test-token'),
}));

vi.mock('@electron/utils/sto-memory-api-auth', () => ({
  buildStoMemoryCenterAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
}));

vi.mock('@electron/utils/sto-domain', () => ({
  resolveStoBaseUrl: vi.fn().mockResolvedValue('https://memory.example.com'),
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { AgentMemoryRemoteService } from '@electron/services/agent-memory-remote-service';

const encoder = new TextEncoder();

function sseResponse(events: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(event));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  });
}

describe('AgentMemoryRemoteService.createChatCompletionStream', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requests OpenAI SSE and returns the assembled assistant text', async () => {
    proxyAwareFetchMock.mockResolvedValue(sseResponse([
      'data: {"choices":[{"index":0,"delta":{"content":"{\\"shouldStore\\":"}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"content":"true}"}}]}\n\n',
      'data: [DONE]\n\n',
    ]));
    const service = new AgentMemoryRemoteService();

    await expect(service.createChatCompletionStream({
      model: 'qwen3.6-plus',
      messages: [{ role: 'user', content: 'summarize' }],
    })).resolves.toBe('{"shouldStore":true}');

    const init = proxyAwareFetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it('falls back to the blocking API when streaming is unsupported', async () => {
    proxyAwareFetchMock.mockResolvedValue(new Response('{"detail":"stream unsupported"}', {
      status: 415,
      headers: { 'Content-Type': 'application/json' },
    }));
    const service = new AgentMemoryRemoteService();
    const fallback = vi.spyOn(service, 'createChatCompletion').mockResolvedValue({
      choices: [{ message: { content: '{"shouldStore":false}' } }],
    });

    await expect(service.createChatCompletionStream({
      model: 'qwen3.6-plus',
      messages: [],
    })).resolves.toBe('{"shouldStore":false}');
    expect(fallback).toHaveBeenCalledWith({ model: 'qwen3.6-plus', messages: [] });
  });
});
