import { describe, expect, it } from 'vitest';
import { omitUnchangedHistoryMessages } from '../../electron/engines/history-rpc-result';
import { buildChatHistoryFingerprint } from '../../shared/chat-history-fingerprint';

const fingerprint = buildChatHistoryFingerprint({
  messages: [{ id: 'm1', timestamp: 1, content: 'hi' }],
  persistedCount: 1,
  liveCount: 0,
});

describe('omitUnchangedHistoryMessages', () => {
  it('omits claude messages when the client fingerprint matches', () => {
    const result = omitUnchangedHistoryMessages({
      engineType: 'claude',
      clientFingerprint: fingerprint,
      result: {
        messages: [{ id: 'm1', content: 'hi' }],
        fingerprint,
        isRunning: false,
      },
    });
    expect(result.unchanged).toBe(true);
    expect(result.messages).toEqual([]);
    expect(result.fingerprint).toEqual(fingerprint);
  });

  it('keeps claude messages when live cache changed', () => {
    const next = buildChatHistoryFingerprint({
      messages: [{ id: 'm1', timestamp: 1, content: 'hi' }, { id: 'm2', timestamp: 2, content: 'tool' }],
      persistedCount: 1,
      liveCount: 1,
    });
    const result = omitUnchangedHistoryMessages({
      engineType: 'claude',
      clientFingerprint: fingerprint,
      result: {
        messages: [{ id: 'm1' }, { id: 'm2' }],
        fingerprint: next,
      },
    });
    expect(result.unchanged).toBeUndefined();
    expect(result.messages).toHaveLength(2);
  });

  it('never omits paged older-history requests', () => {
    const result = omitUnchangedHistoryMessages({
      engineType: 'claude',
      clientFingerprint: fingerprint,
      beforeId: 'm2',
      result: {
        messages: [{ id: 'm0', content: 'older' }],
        fingerprint,
      },
    });
    expect(result.unchanged).toBeUndefined();
    expect(result.messages).toHaveLength(1);
  });

  it('never omits openclaw payloads', () => {
    const result = omitUnchangedHistoryMessages({
      engineType: 'openclaw',
      clientFingerprint: fingerprint,
      result: {
        messages: [{ id: 'm1', content: 'hi' }],
        fingerprint,
      },
    });
    expect(result.unchanged).toBeUndefined();
    expect(result.messages).toHaveLength(1);
  });
});
