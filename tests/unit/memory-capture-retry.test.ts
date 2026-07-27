import { afterEach, describe, expect, it, vi } from 'vitest';

import { scheduleMemoryCaptureRetry } from '@electron/services/memory-capture-retry';

describe('scheduleMemoryCaptureRetry', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks a retry_wait job ready before invoking the retry callback', async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    scheduleMemoryCaptureRetry(
      30_000,
      async () => { events.push('ready'); },
      () => { events.push('retry'); },
      () => { events.push('error'); },
    );

    await vi.advanceTimersByTimeAsync(30_000);
    expect(events).toEqual(['ready', 'retry']);
  });

  it('does not retry when restoring the job to ready fails', async () => {
    vi.useFakeTimers();
    const retry = vi.fn();
    const onError = vi.fn();
    scheduleMemoryCaptureRetry(
      30_000,
      async () => { throw new Error('database unavailable'); },
      retry,
      onError,
    );

    await vi.advanceTimersByTimeAsync(30_000);
    expect(retry).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });
});
