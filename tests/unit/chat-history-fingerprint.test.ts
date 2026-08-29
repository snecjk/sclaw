import { describe, expect, it } from 'vitest';
import {
  buildChatHistoryFingerprint,
  chatHistoryFingerprintsEqual,
  isChatHistoryFingerprint,
} from '../../shared/chat-history-fingerprint';

const sampleMessages = [
  { id: 'm1', timestamp: 1, content: 'hello' },
  { id: 'm2', timestamp: 2, content: 'world' },
];

describe('chat history fingerprint', () => {
  it('covers persisted, live, last message, archived set, and content size', () => {
    const fingerprint = buildChatHistoryFingerprint({
      messages: sampleMessages,
      persistedCount: 2,
      liveCount: 1,
      archivedIds: ['arch-a', 'arch-b'],
    });
    expect(fingerprint.mergedCount).toBe(2);
    expect(fingerprint.persistedCount).toBe(2);
    expect(fingerprint.liveCount).toBe(1);
    expect(fingerprint.lastId).toBe('m2');
    expect(fingerprint.lastTimestamp).toBe(2);
    expect(fingerprint.archivedKey).toBe('arch-a\u0000arch-b');
    expect(fingerprint.contentHash).toBeGreaterThan(0);
  });

  it('treats live-count changes as a different fingerprint', () => {
    const base = buildChatHistoryFingerprint({
      messages: sampleMessages,
      persistedCount: 2,
      liveCount: 0,
    });
    const withLive = buildChatHistoryFingerprint({
      messages: sampleMessages,
      persistedCount: 2,
      liveCount: 1,
    });
    expect(chatHistoryFingerprintsEqual(base, withLive)).toBe(false);
  });

  it('treats archived session-id changes as a different fingerprint', () => {
    const left = buildChatHistoryFingerprint({
      messages: sampleMessages,
      persistedCount: 2,
      liveCount: 0,
      archivedIds: ['a'],
    });
    const right = buildChatHistoryFingerprint({
      messages: sampleMessages,
      persistedCount: 2,
      liveCount: 0,
      archivedIds: ['a', 'b'],
    });
    expect(chatHistoryFingerprintsEqual(left, right)).toBe(false);
  });

  it('treats same-id content rewrites as a different fingerprint', () => {
    const left = buildChatHistoryFingerprint({
      messages: sampleMessages,
      persistedCount: 2,
      liveCount: 0,
    });
    const right = buildChatHistoryFingerprint({
      messages: [{ id: 'm1', timestamp: 1, content: 'hello' }, { id: 'm2', timestamp: 2, content: 'WORLD' }],
      persistedCount: 2,
      liveCount: 0,
    });
    expect(chatHistoryFingerprintsEqual(left, right)).toBe(false);
  });

  it('narrows unknown ipc payloads', () => {
    expect(isChatHistoryFingerprint({
      mergedCount: 1,
      persistedCount: 1,
      liveCount: 0,
      lastId: 'm1',
      lastTimestamp: 1,
      archivedKey: '',
      contentHash: 1,
    })).toBe(true);
    expect(isChatHistoryFingerprint({ mergedCount: 1 })).toBe(false);
  });
});
