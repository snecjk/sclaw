import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearChatSendIdempotencyForTests,
  runIdempotentChatSend,
} from '../../electron/api/routes/chat-send-idempotency';

describe('chat send idempotency', () => {
  beforeEach(clearChatSendIdempotencyForTests);

  it('coalesces concurrent and replayed accepted sends', async () => {
    const dispatch = vi.fn(async () => ({ success: true, result: { runId: 'run-1' } }));
    const first = runIdempotentChatSend('agent:main:session-1', 'message-1', dispatch);
    const replay = runIdempotentChatSend('agent:main:session-1', 'message-1', dispatch);

    await expect(first).resolves.toMatchObject({ success: true, result: { runId: 'run-1' } });
    await expect(replay).resolves.toMatchObject({ success: true, result: { runId: 'run-1' } });
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it('allows retry after a definitive rejection', async () => {
    const dispatch = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'rejected' })
      .mockResolvedValueOnce({ success: true, result: { runId: 'run-2' } });

    await expect(runIdempotentChatSend('agent:main:session-1', 'message-2', dispatch))
      .resolves.toMatchObject({ success: false });
    await Promise.resolve();
    await expect(runIdempotentChatSend('agent:main:session-1', 'message-2', dispatch))
      .resolves.toMatchObject({ success: true });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('scopes the same message id to its session', async () => {
    const dispatch = vi.fn(async () => ({ success: true }));
    await runIdempotentChatSend('agent:main:session-a', 'message-3', dispatch);
    await runIdempotentChatSend('agent:main:session-b', 'message-3', dispatch);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('rejects missing identity without dispatching', async () => {
    const dispatch = vi.fn(async () => ({ success: true }));
    await expect(runIdempotentChatSend('', undefined, dispatch))
      .resolves.toMatchObject({ success: false });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
