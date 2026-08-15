import { describe, expect, it } from 'vitest';
import { hasOptimisticUserEcho } from '@/stores/chat/history-apply-loaded';
import type { RawMessage } from '@/stores/chat/types';

const toMs = (value: unknown): number => {
  const timestamp = Number(value);
  return timestamp < 1_000_000_000_000 ? timestamp * 1_000 : timestamp;
};

describe('loaded history optimistic user reconciliation', () => {
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
      } as RawMessage,
      userMsgAt: 100_000,
      toMs,
    })).toBe(true);
  });

  it('clears a normal-chat optimistic turn by id match once the server echo arrives', () => {
    expect(hasOptimisticUserEcho({
      finalMessages: [{
        id: 'renderer-message',
        role: 'user',
        content: 'normal chat',
        timestamp: 106,
      }],
      cachedOptimistic: {
        id: 'renderer-message',
        role: 'user',
        content: 'normal chat',
        timestamp: 100,
      } as RawMessage,
      userMsgAt: 100_000,
      toMs,
    })).toBe(true);
  });

  it('returns false for scheduled tasks (no optimistic message to reconcile, X2)', () => {
    // X2: 定时任务不再注入乐观 user 消息，cachedOptimistic 恒为 null，
    // hasOptimisticUserEcho 直接返回 false——任务会话的 user 气泡由 server echo 渲染。
    expect(hasOptimisticUserEcho({
      finalMessages: [{
        id: 'server-current-run',
        role: 'user',
        content: 'scheduled prompt',
        timestamp: 106,
      }],
      cachedOptimistic: null,
      userMsgAt: 100_000,
      toMs,
    })).toBe(false);
  });
});
