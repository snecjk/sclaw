import { describe, expect, it } from 'vitest';
import {
  mergeHistoryMessageSources,
  mergeHistoryWhenShrunk,
} from '@/stores/chat/history-merge';
import type { RawMessage } from '@/stores/chat/types';

describe('history-merge', () => {
  it('merges sources by id with later sources winning', () => {
    const older: RawMessage = { id: 'a', role: 'assistant', content: 'old', timestamp: 1 };
    const newer: RawMessage = { id: 'a', role: 'assistant', content: 'new', timestamp: 2 };
    const merged = mergeHistoryMessageSources([[older], [newer]]);
    expect(merged).toEqual([newer]);
  });

  it('sorts merged messages by timestamp', () => {
    const merged = mergeHistoryMessageSources([[
      { id: 'b', role: 'assistant', content: 'second', timestamp: 20 },
      { id: 'a', role: 'user', content: 'first', timestamp: 10 },
    ]]);
    expect(merged.map((message) => message.id)).toEqual(['a', 'b']);
  });

  it('preserves older in-memory turns when gateway reload shrinks', () => {
    const current: RawMessage[] = [
      { id: 'cron-meta', role: 'system', content: 'Scheduled task: finance', timestamp: 1 },
      { id: 'user-1', role: 'user', content: 'run workflow', timestamp: 2 },
      { id: 'assistant-1', role: 'assistant', content: 'started', timestamp: 3 },
      { id: 'user-2', role: 'user', content: 'still running?', timestamp: 4 },
    ];
    const loaded: RawMessage[] = [
      { id: 'user-2', role: 'user', content: 'still running?', timestamp: 4 },
      { id: 'assistant-2', role: 'assistant', content: 'yes', timestamp: 5 },
    ];

    const merged = mergeHistoryWhenShrunk(loaded, current);
    expect(merged.map((message) => message.id)).toEqual([
      'cron-meta',
      'user-1',
      'assistant-1',
      'user-2',
      'assistant-2',
    ]);
  });

  it('does not merge when loaded history is already complete', () => {
    const current: RawMessage[] = [
      { id: 'user-1', role: 'user', content: 'hello', timestamp: 1 },
    ];
    const loaded: RawMessage[] = [
      { id: 'user-1', role: 'user', content: 'hello', timestamp: 1 },
      { id: 'assistant-1', role: 'assistant', content: 'hi', timestamp: 2 },
    ];

    expect(mergeHistoryWhenShrunk(loaded, current)).toBe(loaded);
  });
});
