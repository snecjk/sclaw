import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearSessionRuntimeTimers,
  setErrorRecoveryTimer,
  setHistoryPollTimer,
  setStuckCheckTimer,
} from '@/stores/chat/runtime-timers';

describe('per-session chat runtime timers', () => {
  afterEach(() => {
    clearSessionRuntimeTimers('session-a');
    clearSessionRuntimeTimers('session-b');
    vi.useRealTimers();
  });

  it('clearing one session does not cancel another session timers', () => {
    vi.useFakeTimers();
    const fired: string[] = [];

    setHistoryPollTimer('session-a', setTimeout(() => fired.push('a-history'), 10));
    setErrorRecoveryTimer('session-a', setTimeout(() => fired.push('a-error'), 10));
    setStuckCheckTimer('session-a', setTimeout(() => fired.push('a-stuck'), 10));
    setHistoryPollTimer('session-b', setTimeout(() => fired.push('b-history'), 10));
    setErrorRecoveryTimer('session-b', setTimeout(() => fired.push('b-error'), 10));
    setStuckCheckTimer('session-b', setTimeout(() => fired.push('b-stuck'), 10));

    clearSessionRuntimeTimers('session-a');
    vi.advanceTimersByTime(20);

    expect(fired).toEqual(['b-history', 'b-error', 'b-stuck']);
  });
});
