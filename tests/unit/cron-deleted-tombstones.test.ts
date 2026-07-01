import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyCronDeletedTombstones,
  CRON_DELETED_TOMBSTONE_TTL_MS,
  rememberDeletedCronJob,
  resetCronDeletedTombstonesForTests,
} from '@/stores/cron-deleted-tombstones';

const hostApiFetchMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

describe('cron-deleted-tombstones', () => {
  beforeEach(() => {
    resetCronDeletedTombstonesForTests();
  });

  afterEach(() => {
    resetCronDeletedTombstonesForTests();
  });

  it('filters tombstoned jobs from a stale gateway list', () => {
    rememberDeletedCronJob('job-1', 'openclaw');
    const filtered = applyCronDeletedTombstones([
      { id: 'job-1', engineType: 'openclaw' as const, name: 'Workflow task' },
      { id: 'job-2', engineType: 'openclaw' as const, name: 'Other' },
    ]);
    expect(filtered.map((job) => job.id)).toEqual(['job-2']);
  });

  it('clears tombstone once gateway list no longer contains the id', () => {
    rememberDeletedCronJob('job-1', 'openclaw');
    applyCronDeletedTombstones([
      { id: 'job-2', engineType: 'openclaw' as const, name: 'Other' },
    ]);
    const filtered = applyCronDeletedTombstones([
      { id: 'job-1', engineType: 'openclaw' as const, name: 'Workflow task' },
    ]);
    expect(filtered.map((job) => job.id)).toEqual(['job-1']);
  });

  it('expires tombstones after TTL so failed deletes can resurface', () => {
    const now = 1_000_000;
    rememberDeletedCronJob('job-1', 'openclaw', now);
    const filtered = applyCronDeletedTombstones(
      [{ id: 'job-1', engineType: 'openclaw' as const, name: 'Workflow task' }],
      now + CRON_DELETED_TOMBSTONE_TTL_MS + 1,
    );
    expect(filtered.map((job) => job.id)).toEqual(['job-1']);
  });
});

describe('cron store deleteJob', () => {
  beforeEach(() => {
    vi.resetModules();
    resetCronDeletedTombstonesForTests();
    hostApiFetchMock.mockReset();
  });

  afterEach(() => {
    resetCronDeletedTombstonesForTests();
  });

  it('keeps job hidden when fetchJobs returns stale list after delete', async () => {
    hostApiFetchMock
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: 'job-1', name: 'Workflow task', enabled: true }])
      .mockResolvedValueOnce([]);

    const { useCronStore } = await import('@/stores/cron');
    useCronStore.setState({
      jobs: [{ id: 'job-1', name: 'Workflow task', enabled: true, engineType: 'openclaw' }],
      loading: false,
      error: null,
      scheduledTasks: [],
      scheduledTasksError: null,
    });

    await useCronStore.getState().deleteJob('job-1', 'openclaw');
    expect(useCronStore.getState().jobs).toHaveLength(0);

    await useCronStore.getState().fetchJobs();
    expect(useCronStore.getState().jobs).toHaveLength(0);

    hostApiFetchMock.mockResolvedValueOnce([]);
    hostApiFetchMock.mockResolvedValueOnce([]);
    await useCronStore.getState().fetchJobs();
    expect(useCronStore.getState().jobs).toHaveLength(0);
  });
});
