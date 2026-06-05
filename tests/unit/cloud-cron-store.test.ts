/**
 * Cloud Cron Store Tests
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeIpcMock = vi.fn();

vi.mock('@/lib/api-client', () => ({
  invokeIpc: (...args: unknown[]) => invokeIpcMock(...args),
}));

describe('cron store cloud actions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    invokeIpcMock.mockReset();
  });

  it('fetchJobs merges local and cloud jobs', async () => {
    invokeIpcMock
      .mockResolvedValueOnce({
        ok: true,
        data: { status: 200, ok: true, json: [{ id: 'local-1', name: 'Local Task', enabled: true }] },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { status: 200, ok: true, json: [{ id: 'cloud-1', name: 'Cloud Task', enabled: true }] },
      });

    const { useCronStore } = await import('@/stores/cron');
    const store = useCronStore.getState();
    await store.fetchJobs();

    const state = useCronStore.getState();
    expect(state.jobs).toHaveLength(1);
    expect(state.jobs[0].id).toBe('local-1');
    expect(state.cloudJobs).toHaveLength(1);
    expect(state.cloudJobs[0].id).toBe('cloud-1');
  });

  it('createCloudJob adds job to cloudJobs list', async () => {
    invokeIpcMock.mockResolvedValueOnce({
      ok: true,
      data: { status: 200, ok: true, json: { id: 'cloud-new', name: 'New Cloud Task', message: 'Hello', schedule: '0 9 * * *', agentId: 'agent-1', enabled: true } },
    });

    const { useCronStore } = await import('@/stores/cron');
    const store = useCronStore.getState();
    const job = await store.createCloudJob({
      name: 'New Cloud Task',
      message: 'Hello',
      schedule: '0 9 * * *',
      agentId: 'agent-1',
    });

    expect(job.id).toBe('cloud-new');
    const state = useCronStore.getState();
    expect(state.cloudJobs.some((j) => j.id === 'cloud-new')).toBe(true);
    expect(invokeIpcMock).toHaveBeenCalledWith(
      'hostapi:fetch',
      expect.objectContaining({
        path: '/api/cron/cloud/jobs',
        method: 'POST',
      }),
    );
  });

  it('updateCloudJob updates existing cloud job in store', async () => {
    invokeIpcMock.mockResolvedValueOnce({
      ok: true,
      data: { status: 200, ok: true, json: { id: 'cloud-1', name: 'Updated', message: 'Hello', schedule: '0 9 * * *', agentId: 'agent-1', enabled: true } },
    });

    const { useCronStore } = await import('@/stores/cron');
    const store = useCronStore.getState();
    // Pre-populate cloudJobs
    useCronStore.setState({
      cloudJobs: [{ id: 'cloud-1', name: 'Old', message: 'Hi', schedule: '0 8 * * *', agentId: 'agent-1', enabled: true, createdAt: '', updatedAt: '' }],
    });

    await store.updateCloudJob('cloud-1', { name: 'Updated' });

    const state = useCronStore.getState();
    expect(state.cloudJobs[0].name).toBe('Updated');
  });

  it('deleteCloudJob removes job from cloudJobs list', async () => {
    invokeIpcMock.mockResolvedValueOnce({
      ok: true,
      data: { status: 204 },
    });

    const { useCronStore } = await import('@/stores/cron');
    useCronStore.setState({
      cloudJobs: [{ id: 'cloud-1', name: 'Task', message: 'Hi', schedule: '* * * * *', agentId: 'agent-1', enabled: true, createdAt: '', updatedAt: '' }],
    });

    const store = useCronStore.getState();
    await store.deleteCloudJob('cloud-1');

    const state = useCronStore.getState();
    expect(state.cloudJobs).toHaveLength(0);
  });

  it('toggleCloudJob updates enabled state', async () => {
    invokeIpcMock.mockResolvedValueOnce({
      ok: true,
      data: { status: 200, ok: true, json: { success: true } },
    });

    const { useCronStore } = await import('@/stores/cron');
    useCronStore.setState({
      cloudJobs: [{ id: 'cloud-1', name: 'Task', message: 'Hi', schedule: '* * * * *', agentId: 'agent-1', enabled: true, createdAt: '', updatedAt: '' }],
    });

    const store = useCronStore.getState();
    await store.toggleCloudJob('cloud-1', false);

    const state = useCronStore.getState();
    expect(state.cloudJobs[0].enabled).toBe(false);
  });

  it('triggerCloudJob calls trigger endpoint', async () => {
    invokeIpcMock.mockResolvedValueOnce({
      ok: true,
      data: { status: 200, ok: true, json: { runId: 'run-1', status: 'queued' } },
    });

    const { useCronStore } = await import('@/stores/cron');
    const store = useCronStore.getState();
    await store.triggerCloudJob('cloud-1');

    expect(invokeIpcMock).toHaveBeenCalledWith(
      'hostapi:fetch',
      expect.objectContaining({
        path: '/api/cron/cloud/trigger',
        method: 'POST',
        body: expect.stringContaining('cloud-1'),
      }),
    );
  });

  it('syncCloudResults fetches and caches new results', async () => {
    invokeIpcMock
      .mockResolvedValueOnce({
        ok: true,
        data: {
          status: 200,
          ok: true,
          json: {
            results: [{ id: 'result-1', taskId: 'cloud-1', status: 'success', startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:01:00Z', duration: 60000 }],
            hasMore: false,
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { status: 200, ok: true, json: { success: true, written: 1 } },
      });

    const { useCronStore } = await import('@/stores/cron');
    const store = useCronStore.getState();
    const results = await store.syncCloudResults();

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('result-1');
    expect(invokeIpcMock).toHaveBeenCalledWith(
      'hostapi:fetch',
      expect.objectContaining({
        path: expect.stringContaining('/api/cron/cloud/results'),
        method: 'GET',
      }),
    );
  });

  it('fetchCloudAgents populates cloudAgents list', async () => {
    invokeIpcMock.mockResolvedValueOnce({
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: [{ id: 'agent-1', name: 'Cloud Bot', model: 'gpt-4', status: 'online' }],
      },
    });

    const { useCronStore } = await import('@/stores/cron');
    const store = useCronStore.getState();
    await store.fetchCloudAgents();

    const state = useCronStore.getState();
    expect(state.cloudAgents).toHaveLength(1);
    expect(state.cloudAgents[0].name).toBe('Cloud Bot');
  });
});
