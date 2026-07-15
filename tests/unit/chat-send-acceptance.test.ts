import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/error-model';
import { buildUncertainAcceptancePatch, isUncertainDispatchError } from '@/stores/chat/send-actions';
import { createIdleSessionRuntimeState } from '@/stores/chat/session-runtime';

describe('chat send acceptance', () => {
  it('treats timeout and network failures as an unknown acceptance result', () => {
    expect(isUncertainDispatchError(new AppError('TIMEOUT', 'request timed out'))).toBe(true);
    expect(isUncertainDispatchError(new AppError('NETWORK', 'connection reset'))).toBe(true);
  });

  it('keeps explicit gateway rejection as a definitive failure', () => {
    expect(isUncertainDispatchError(new AppError('GATEWAY', 'Gateway rejected request'))).toBe(false);
    expect(isUncertainDispatchError(new AppError('CONFIG', 'invalid request'))).toBe(false);
  });

  it('keeps a matching timed-out send active while reconciliation continues', () => {
    const patch = buildUncertainAcceptancePatch({
      ...createIdleSessionRuntimeState(),
      sending: true,
      sendAcceptance: {
        idempotencyKey: 'message-1',
        status: 'pending',
        startedAt: 100,
      },
    }, 'message-1');

    expect(patch).toMatchObject({
      sending: true,
      error: null,
      sendAcceptance: { idempotencyKey: 'message-1', status: 'uncertain' },
    });
  });
});
