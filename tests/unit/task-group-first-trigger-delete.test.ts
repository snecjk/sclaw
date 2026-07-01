import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}));

import { toast } from 'sonner';
import {
  getCachedTaskGroupFirstTriggeredMap,
  rememberOptimisticTaskGroupFirstTriggered,
} from '@/lib/task-group-first-trigger';
import {
  collectAdditionalSuppressKeysForLastGroupSessionDelete,
  prepareFirstTriggerClearBeforeLastSessionDelete,
  revertFirstTriggerClearAfterFailedDelete,
} from '@/lib/task-group-first-trigger-delete';
import { isTaskGroupFirstTriggerOptimisticallyCleared } from '@/lib/task-group-first-trigger';

describe('task-group-first-trigger-delete', () => {
  beforeEach(() => {
    hostApiFetchMock.mockReset();
    vi.mocked(toast.error).mockReset();
    hostApiFetchMock.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
      if (path === '/api/task-groups/first-triggered-at' && init?.method === 'GET') {
        return { map: {} };
      }
      return { success: true, cleared: true };
    });
  });

  it('prepare clears persisted first-trigger before last session delete', async () => {
    rememberOptimisticTaskGroupFirstTriggered('cron:job-6', Date.parse('2026-06-28T10:00:00+08:00'));

    const prep = await prepareFirstTriggerClearBeforeLastSessionDelete('cron:job-6');

    expect(prep).toEqual({
      groupKey: 'cron:job-6',
      restoreAtMs: Date.parse('2026-06-28T10:00:00+08:00'),
    });
    expect(getCachedTaskGroupFirstTriggeredMap()['cron:job-6']).toBeUndefined();
    expect(hostApiFetchMock).toHaveBeenCalledWith(
      '/api/task-groups/first-triggered-at',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ groupKey: 'cron:job-6', action: 'clear' }),
      }),
    );
  });

  it('prepare aborts delete flow and rolls back optimistic state when clear API fails', async () => {
    const atMs = Date.parse('2026-06-28T10:00:00+08:00');
    rememberOptimisticTaskGroupFirstTriggered('cron:job-6', atMs);
    hostApiFetchMock.mockResolvedValueOnce({ success: false });

    const prep = await prepareFirstTriggerClearBeforeLastSessionDelete('cron:job-6');

    expect(prep).toBeNull();
    expect(getCachedTaskGroupFirstTriggeredMap()['cron:job-6']).toBe(atMs);
    expect(toast.error).toHaveBeenCalled();
  });

  it('revert restores persisted first-trigger after failed deleteSession', async () => {
    const atMs = Date.parse('2026-06-28T10:00:00+08:00');
    hostApiFetchMock.mockImplementation(async (_path: string, init?: { method?: string; body?: string }) => {
      if (init?.method === 'POST' && init.body?.includes('"action":"reset"')) {
        return { success: true, triggeredAtMs: atMs };
      }
      return { success: true, cleared: true };
    });

    await revertFirstTriggerClearAfterFailedDelete({ groupKey: 'cron:job-6', restoreAtMs: atMs });

    expect(getCachedTaskGroupFirstTriggeredMap()['cron:job-6']).toBe(atMs);
    expect(hostApiFetchMock).toHaveBeenCalledWith(
      '/api/task-groups/first-triggered-at',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ groupKey: 'cron:job-6', action: 'reset', triggeredAtMs: atMs }),
      }),
    );
  });

  it('uses fallbackAtMs when cache has no first-trigger snapshot', async () => {
    const fallbackAtMs = Date.parse('2026-06-27T08:00:00+08:00');

    const prep = await prepareFirstTriggerClearBeforeLastSessionDelete('cron:job-7', { fallbackAtMs });

    expect(prep?.restoreAtMs).toBe(fallbackAtMs);
  });

  it('collectAdditionalSuppressKeys includes first-trigger placeholder when date differs', () => {
    const firstAtMs = Date.parse('2026-06-28T10:00:00+08:00');
    const deletingKey = 'agent:main:cron:job-6:2026-06-30';

    const keys = collectAdditionalSuppressKeysForLastGroupSessionDelete(
      'cron:job-6',
      [{ key: deletingKey }],
      deletingKey,
      firstAtMs,
    );

    expect(keys).toEqual(['agent:main:cron:job-6:2026-06-28']);
  });

  it('isTaskGroupFirstTriggerOptimisticallyCleared after prepare clear', async () => {
    rememberOptimisticTaskGroupFirstTriggered('cron:job-8', Date.parse('2026-06-28T10:00:00+08:00'));

    await prepareFirstTriggerClearBeforeLastSessionDelete('cron:job-8');

    expect(isTaskGroupFirstTriggerOptimisticallyCleared('cron:job-8')).toBe(true);
  });
});
