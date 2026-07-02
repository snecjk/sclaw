import { describe, expect, it } from 'vitest';
import { shouldSuppressDeletedExecutionRecord } from '../../shared/deleted-session-suppress';

describe('deleted-session-suppress', () => {
  it('suppresses exact deleted dated cron key', () => {
    const key = 'agent:main:cron:job-1:2026-06-25';
    expect(shouldSuppressDeletedExecutionRecord({ key }, new Set([key]))).toBe(true);
  });

  it('suppresses cron run session when dated aggregate for same day was deleted', () => {
    const deleted = new Set(['agent:main:cron:job-1:2026-06-25']);
    const runKey = 'agent:main:cron:job-1:run:abc';
    const ts = new Date(2026, 5, 25, 10, 0, 0).getTime();
    expect(shouldSuppressDeletedExecutionRecord({ key: runKey, updatedAt: ts }, deleted)).toBe(true);
  });

  it('does not suppress cron run on a different day', () => {
    const deleted = new Set(['agent:main:cron:job-1:2026-06-25']);
    const runKey = 'agent:main:cron:job-1:run:abc';
    const ts = new Date(2026, 5, 24, 10, 0, 0).getTime();
    expect(shouldSuppressDeletedExecutionRecord({ key: runKey, updatedAt: ts }, deleted)).toBe(false);
  });
});
