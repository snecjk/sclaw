/**
 * Cloud Task Service Tests
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// Mock auth store
vi.mock('../../electron/utils/auth-store', () => ({
  getStoToken: vi.fn().mockResolvedValue('test-token'),
  getSsoEnvironment: vi.fn().mockResolvedValue('daily-external'),
}));

// Mock sto-domain
vi.mock('../../electron/utils/sto-domain', () => ({
  resolveStoBaseUrl: vi.fn().mockResolvedValue('https://baseinfo-aimemory-test.sto.cn'),
}));

describe('CloudTaskService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
  });

  it('listTasks fetches cloud tasks from external API', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tasks: [
          { id: 'task-1', name: 'Daily Report', schedule: { expr: '0 9 * * *' }, enabled: true },
        ],
      }),
    });

    const { getCloudTaskService } = await import('../../electron/services/cloud-task-service');
    const service = getCloudTaskService();
    const tasks = await service.listTasks();

    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('task-1');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/agent/v1/cloud-cron/tasks'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('createTask sends POST request with task data', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        task: { id: 'task-new', name: 'Test Task', message: 'Hello', schedule: { expr: '* * * * *' }, agentId: 'agent-1', enabled: true },
      }),
    });

    const { getCloudTaskService } = await import('../../electron/services/cloud-task-service');
    const service = getCloudTaskService();
    const task = await service.createTask({
      name: 'Test Task',
      message: 'Hello',
      schedule: '* * * * *',
      agentId: 'agent-1',
    });

    expect(task.id).toBe('task-new');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/agent/v1/cloud-cron/tasks'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Test Task'),
      }),
    );
  });

  it('updateTask sends PUT request and returns updated task', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        task: { id: 'task-1', name: 'Updated Task', schedule: { expr: '0 10 * * *' }, enabled: true },
      }),
    });

    const { getCloudTaskService } = await import('../../electron/services/cloud-task-service');
    const service = getCloudTaskService();
    const task = await service.updateTask('task-1', { name: 'Updated Task' });

    expect(task.name).toBe('Updated Task');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/agent/v1/cloud-cron/tasks/task-1'),
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('deleteTask sends DELETE request', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    const { getCloudTaskService } = await import('../../electron/services/cloud-task-service');
    const service = getCloudTaskService();
    await service.deleteTask('task-1');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/agent/v1/cloud-cron/tasks/task-1'),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('toggleTask sends PATCH request', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    const { getCloudTaskService } = await import('../../electron/services/cloud-task-service');
    const service = getCloudTaskService();
    await service.toggleTask('task-1', false);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/agent/v1/cloud-cron/tasks/task-1/enabled'),
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining('false'),
      }),
    );
  });

  it('triggerTask sends POST request', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ runId: 'run-1', status: 'queued' }),
    });

    const { getCloudTaskService } = await import('../../electron/services/cloud-task-service');
    const service = getCloudTaskService();
    const result = await service.triggerTask('task-1');

    expect(result.runId).toBe('run-1');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/agent/v1/cloud-cron/tasks/task-1/trigger'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('fetchResults queries with since cursor', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ id: 'result-1', taskId: 'task-1', status: 'success' }],
        hasMore: false,
      }),
    });

    const { getCloudTaskService } = await import('../../electron/services/cloud-task-service');
    const service = getCloudTaskService();
    const result = await service.fetchResults({ since: '2026-01-01T00:00:00Z' });

    expect(result.results).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('since=2026-01-01T00%3A00%3A00Z'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('listCloudAgents fetches from agents endpoint', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        agents: [{ id: 'agent-1', name: 'Cloud Bot', model: 'gpt-4', status: 'online' }],
      }),
    });

    const { getCloudTaskService } = await import('../../electron/services/cloud-task-service');
    const service = getCloudTaskService();
    const agents = await service.listCloudAgents();

    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('Cloud Bot');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/agent/v1/agents?environment=cloud'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('throws error when API returns non-ok status', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const { getCloudTaskService } = await import('../../electron/services/cloud-task-service');
    const service = getCloudTaskService();

    await expect(service.listTasks()).rejects.toThrow('Cloud task list failed (500)');
  });
});
