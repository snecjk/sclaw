import { describe, expect, it } from 'vitest';

import { selectLatestContextUsage } from '../../src/pages/Chat/context-usage/context-usage-selection';
import type { ChatContextUsage } from '../../shared/chat-runtime-protocol';

function usage(percent: number | null, updatedAt: number, accuracy: ChatContextUsage['accuracy'] = 'exact'): ChatContextUsage {
  return {
    tokens: percent == null ? null : percent * 1_000,
    contextWindow: percent == null ? null : 100_000,
    percent,
    accuracy,
    updatedAt,
  };
}

describe('selectLatestContextUsage', () => {
  it('uses a newer persisted fetch instead of a stale runtime snapshot', () => {
    expect(selectLatestContextUsage(usage(30, 100), usage(41, 200))).toEqual(usage(41, 200));
  });

  it('keeps a newer runtime event instead of an older persisted fetch', () => {
    expect(selectLatestContextUsage(usage(42, 300), usage(30, 200))).toEqual(usage(42, 300));
  });

  it('lets a newer unknown compaction state invalidate an older exact value', () => {
    expect(selectLatestContextUsage(usage(null, 300, 'unknown'), usage(30, 200))).toEqual(
      usage(null, 300, 'unknown'),
    );
  });

  it('falls back to whichever source exists', () => {
    expect(selectLatestContextUsage(null, usage(30, 200))).toEqual(usage(30, 200));
    expect(selectLatestContextUsage(usage(30, 200), null)).toEqual(usage(30, 200));
  });
});
