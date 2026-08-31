import { describe, expect, it } from 'vitest';
import {
  mergeHistoryTail,
  prependHistoryPage,
  sliceHistoryPage,
} from '../../shared/chat-history-page';

const messages = [
  { id: 'a', timestamp: 1, content: '1' },
  { id: 'b', timestamp: 2, content: '2' },
  { id: 'c', timestamp: 3, content: '3' },
  { id: 'd', timestamp: 4, content: '4' },
];

describe('sliceHistoryPage', () => {
  it('returns the newest limit messages and reports remaining older pages', () => {
    expect(sliceHistoryPage(messages, { limit: 2 })).toEqual({
      messages: [messages[2], messages[3]],
      hasMore: true,
      totalCount: 4,
    });
  });

  it('returns the page before a cursor', () => {
    expect(sliceHistoryPage(messages, { limit: 2, beforeId: 'c' })).toEqual({
      messages: [messages[0], messages[1]],
      hasMore: false,
      totalCount: 4,
    });
  });
});

describe('mergeHistoryTail', () => {
  it('keeps already-loaded older messages when refreshing the tail', () => {
    const existing = messages;
    const incoming = [messages[2], messages[3], { id: 'e', timestamp: 5, content: '5' }];
    expect(mergeHistoryTail(existing, incoming).map((message) => message.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('prependHistoryPage', () => {
  it('inserts older messages without duplicating ids', () => {
    const existing = [messages[2], messages[3]];
    const older = [messages[0], messages[1], messages[2]];
    expect(prependHistoryPage(existing, older).map((message) => message.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
