import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testRoot, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testRoot: `/tmp/stoclaw-claude-service-root-${suffix}`,
    testUserData: `/tmp/stoclaw-claude-service-user-data-${suffix}`,
  };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => testUserData,
    getVersion: () => '0.0.0-test',
  },
}));

vi.mock('../../electron/utils/paths', async () => {
  const actual = await vi.importActual<typeof import('../../electron/utils/paths')>('../../electron/utils/paths');
  return {
    ...actual,
    getClawXConfigDir: () => testRoot,
    getClaudeScheduledTasksDir: () => join(testRoot, 'claude-scheduled-tasks'),
  };
});

describe('ClaudeScheduledTaskService', () => {
  beforeEach(async () => {
    vi.resetModules();
    await rm(testRoot, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('creates, lists, updates and deletes local Claude tasks', async () => {
    const { ClaudeScheduledTaskService } = await import('@electron/services/claude-scheduled-task-service');
    const scheduler = {
      refreshSchedule: vi.fn().mockResolvedValue([]),
      start: vi.fn(),
      stop: vi.fn(),
      triggerTaskNow: vi.fn(),
    };
    const service = new ClaudeScheduledTaskService(scheduler as never);

    const created = await service.createTask({
      name: 'Daily summary',
      cronExpr: '0 9 * * *',
      promptTemplate: 'Summarize daily sales',
      agentId: 'main',
      workspacePath: '/tmp/workspace',
    });

    expect(created.id).toBeTruthy();
    expect((await service.listTasks())[0]?.name).toBe('Daily summary');

    const updated = await service.updateTask({
      id: created.id,
      enabled: false,
      timeoutSec: 120,
    });
    expect(updated.enabled).toBe(false);
    expect(updated.timeoutSec).toBe(120);

    await service.deleteTask(created.id);
    await expect(service.listTasks()).resolves.toEqual([]);
  });
});
