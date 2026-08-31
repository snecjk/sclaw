import { describe, expect, it } from 'vitest';
import { shouldSkipQuietHistoryRpc } from '@/stores/chat/history-load-actions';

describe('shouldSkipQuietHistoryRpc', () => {
  it('skips quiet switch reloads when local transcript exists', () => {
    expect(shouldSkipQuietHistoryRpc({
      quiet: true,
      force: false,
      cachedTranscriptCount: 450,
    })).toBe(true);
  });

  it('does not skip a cold load without cache', () => {
    expect(shouldSkipQuietHistoryRpc({
      quiet: false,
      force: false,
      cachedTranscriptCount: 0,
    })).toBe(false);
  });

  it('does not skip event-driven force reloads', () => {
    expect(shouldSkipQuietHistoryRpc({
      quiet: true,
      force: true,
      cachedTranscriptCount: 450,
    })).toBe(false);
  });
});
