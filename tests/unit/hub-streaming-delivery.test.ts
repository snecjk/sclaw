import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendDelta = vi.hoisted(() => vi.fn(() => true));

vi.mock('@electron/message-channel/hub/hub-client', () => ({
  getSclawHubClient: () => ({ sendDelta }),
}));

vi.mock('@electron/message-channel/hub/hub-api', () => ({
  hubReplyStream: vi.fn(async () => undefined),
}));

vi.mock('@electron/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { classifyChatMessage } from '@electron/engines/agent-terminal-detect';
import { attachStreamingDelivery } from '@electron/message-channel/hub/delivery';
import type { GatewayManager } from '@electron/gateway/manager';

describe('classifyChatMessage Pi completed', () => {
  it('maps state=completed to non-error terminal (done)', () => {
    const result = classifyChatMessage(
      { sessionKey: 'agent:main:dingtalk:u1:x', state: 'completed' },
      'agent:main:dingtalk:u1:x',
    );
    expect(result).toEqual({ kind: 'terminal', state: 'done', isError: false });
  });

  it('keeps final as fragment (never terminal)', () => {
    const result = classifyChatMessage(
      {
        sessionKey: 's1',
        state: 'final',
        message: { content: [{ type: 'text', text: '口播' }] },
      },
      's1',
    );
    expect(result).toEqual({
      kind: 'fragment',
      state: 'final',
      answer: '口播',
      status: '',
    });
  });
});

describe('attachStreamingDelivery', () => {
  const sessionKey = 'agent:main:dingtalk:peer:sess';
  let gateway: EventEmitter;

  beforeEach(() => {
    vi.useFakeTimers();
    sendDelta.mockClear();
    sendDelta.mockReturnValue(true);
    gateway = new EventEmitter();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function attach(chatUid: string) {
    return attachStreamingDelivery({
      gatewayManager: gateway as unknown as GatewayManager,
      sessionKey,
      chatUid,
      engineType: 'pi',
      timeoutMs: 60_000,
    });
  }

  function pushesFor(chatUid: string) {
    return sendDelta.mock.calls.filter((call) => call[0] === chatUid);
  }

  it('does not finalize on final fragment alone', async () => {
    const handle = attach('chat-1');
    gateway.emit('chat:message', {
      message: {
        sessionKey,
        state: 'final',
        message: { content: [{ type: 'text', text: '还在说' }] },
      },
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(pushesFor('chat-1').some((c) => c[2] === true)).toBe(false);
    handle.detach();
    await handle.finished;
  });

  it('finalizes on legacy state=completed', async () => {
    const handle = attach('chat-1');
    gateway.emit('chat:message', {
      message: {
        sessionKey,
        state: 'delta',
        message: { content: [{ type: 'text', text: '你好世界' }] },
      },
    });
    await vi.advanceTimersByTimeAsync(500);
    gateway.emit('chat:message', {
      message: { sessionKey, state: 'completed' },
    });
    await vi.advanceTimersByTimeAsync(200);
    await handle.finished;
    const finals = pushesFor('chat-1').filter((c) => c[2] === true);
    expect(finals.length).toBeGreaterThanOrEqual(1);
    expect(finals.at(-1)?.[1]).toContain('你好世界');
  });

  it('finalizes on engineEvent turn.completed', async () => {
    const handle = attach('chat-1');
    gateway.emit('chat:message', {
      message: {
        sessionKey,
        state: 'delta',
        message: { content: [{ type: 'text', text: 'via engineEvent' }] },
      },
      engineEvent: { type: 'message.delta', sessionKey, message: {} },
    });
    await vi.advanceTimersByTimeAsync(500);
    gateway.emit('chat:message', {
      message: { sessionKey, state: 'completed' },
      engineEvent: { type: 'turn.completed', sessionKey },
    });
    await vi.advanceTimersByTimeAsync(200);
    await handle.finished;
    expect(pushesFor('chat-1').some((c) => c[2] === true)).toBe(true);
  });

  it('after first turn completes, second turn deltas only hit chatUid2', async () => {
    const first = attach('chat-uid-1');
    gateway.emit('chat:message', {
      message: {
        sessionKey,
        state: 'delta',
        message: { content: [{ type: 'text', text: '第一轮回答' }] },
      },
    });
    await vi.advanceTimersByTimeAsync(500);
    gateway.emit('chat:message', {
      message: { sessionKey, state: 'completed' },
    });
    await vi.advanceTimersByTimeAsync(200);
    await first.finished;

    sendDelta.mockClear();
    const second = attach('chat-uid-2');
    gateway.emit('chat:message', {
      message: {
        sessionKey,
        state: 'delta',
        message: { content: [{ type: 'text', text: '第二轮回答' }] },
      },
    });
    await vi.advanceTimersByTimeAsync(500);

    expect(pushesFor('chat-uid-1')).toHaveLength(0);
    expect(pushesFor('chat-uid-2').length).toBeGreaterThan(0);
    expect(pushesFor('chat-uid-2').some((c) => String(c[1]).includes('第二轮回答'))).toBe(true);

    second.detach();
    await second.finished;
  });
});
