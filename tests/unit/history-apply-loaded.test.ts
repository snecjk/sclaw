import { describe, expect, it } from 'vitest';
import { hasOptimisticUserEcho } from '@/stores/chat/history-apply-loaded';
import type { RawMessage } from '@/stores/chat/types';

const toMs = (value: unknown): number => {
  const timestamp = Number(value);
  return timestamp < 1_000_000_000_000 ? timestamp * 1_000 : timestamp;
};

const optimistic: RawMessage = {
  id: 'current-run',
  role: 'user',
  content: 'repeat scheduled prompt',
  timestamp: 100,
  _scheduledTaskOptimistic: true,
};

describe('loaded history optimistic user reconciliation', () => {
  it('keeps the current optimistic turn when only an older identical task prompt exists', () => {
    expect(hasOptimisticUserEcho({
      finalMessages: [{
        id: 'previous-run',
        role: 'user',
        content: 'repeat scheduled prompt',
        timestamp: 10,
      }],
      cachedOptimistic: optimistic,
      userMsgAt: 100_000,
      toMs,
    })).toBe(false);
  });

  it('clears the optimistic turn when the current task echo is persisted after a delay', () => {
    expect(hasOptimisticUserEcho({
      finalMessages: [{
        id: 'server-current-run',
        role: 'user',
        content: 'repeat scheduled prompt',
        timestamp: 106,
      }],
      cachedOptimistic: optimistic,
      userMsgAt: 100_000,
      toMs,
    })).toBe(true);
  });

  it('accepts an id echo even when its timestamp is unavailable', () => {
    expect(hasOptimisticUserEcho({
      finalMessages: [{
        id: 'current-run',
        role: 'user',
        content: 'decorated gateway prompt',
      }],
      cachedOptimistic: optimistic,
      userMsgAt: 100_000,
      toMs,
    })).toBe(true);
  });

  it('keeps normal-chat echo reconciliation when Gateway omits the timestamp', () => {
    expect(hasOptimisticUserEcho({
      finalMessages: [{
        id: 'gateway-message',
        role: 'user',
        content: 'normal chat',
      }],
      cachedOptimistic: {
        id: 'renderer-message',
        role: 'user',
        content: 'normal chat',
        timestamp: 100,
      },
      userMsgAt: 100_000,
      toMs,
    })).toBe(true);
  });
});
