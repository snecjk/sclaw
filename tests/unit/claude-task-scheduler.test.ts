import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testRoot, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testRoot: `/tmp/stoclaw-claude-scheduler-root-${suffix}`,
    testUserData: `/tmp/stoclaw-claude-scheduler-user-data-${suffix}`,
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

describe('ClaudeTaskScheduler', () => {
  beforeEach(async () => {
    vi.resetModules();
    await rm(testRoot, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('computes next run times for enabled tasks', async () => {
    const store = await import('@electron/services/claude-scheduled-task-store');
    const { ClaudeTaskScheduler } = await import('@electron/services/claude-task-scheduler');

    await store.upsertClaudeScheduledTaskDefinition({
      id: 'task-1',
      name: 'Daily summary',
      enabled: true,
      cronExpr: '0 9 * * *',
      promptTemplate: 'Summarize daily sales',
      agentId: 'main',
      workspacePath: '/tmp/workspace',
      permissionProfile: 'readonly-safe',
      timeoutSec: 60,
      retryPolicy: {
        maxAttempts: 2,
        backoffSec: 30,
      },
      failurePolicy: {
        pauseAfterConsecutiveFailures: 3,
      },
      createdAt: '2026-06-15T00:00:00.000Z',
      updatedAt: '2026-06-15T00:00:00.000Z',
    });

    const scheduler = new ClaudeTaskScheduler(undefined, 60_000);
    const snapshot = await scheduler.refreshSchedule(new Date('2026-06-15T08:30:00.000Z'));

    expect(snapshot).toEqual([
      {
        taskId: 'task-1',
        nextRunAt: '2026-06-16T01:00:00.000Z',
      },
    ]);
  });

  it('dispatches due tasks and advances nextRunAt', async () => {
    const store = await import('@electron/services/claude-scheduled-task-store');
    const { ClaudeTaskScheduler } = await import('@electron/services/claude-task-scheduler');
    const { ClaudeTaskWorker } = await import('@electron/services/claude-task-worker');

    await store.upsertClaudeScheduledTaskDefinition({
      id: 'task-1',
      name: 'Hourly summary',
      enabled: true,
      cronExpr: '0 * * * *',
      promptTemplate: 'Summarize hourly sales',
      agentId: 'main',
      workspacePath: '/tmp/workspace',
      permissionProfile: 'readonly-safe',
      timeoutSec: 60,
      retryPolicy: {
        maxAttempts: 2,
        backoffSec: 30,
      },
      failurePolicy: {
        pauseAfterConsecutiveFailures: 3,
      },
      createdAt: '2026-06-15T00:00:00.000Z',
      updatedAt: '2026-06-15T00:00:00.000Z',
    });

    const worker = new ClaudeTaskWorker(async () => ({
      completedAt: '2026-06-15T10:00:05.000Z',
      status: 'succeeded',
      summary: 'hourly done',
    }));
    const scheduler = new ClaudeTaskScheduler(worker, 60_000);

    await store.writeClaudeScheduledTaskSchedulerState({
      lastTickAt: '2026-06-15T09:00:00.000Z',
      tasks: {
        'task-1': {
          nextRunAt: '2026-06-15T10:00:00.000Z',
        },
      },
    });

    await scheduler.tick(new Date('2026-06-15T10:00:00.000Z'));

    const latest = await store.getLatestClaudeScheduledTaskRunRecord('task-1');
    expect(latest?.status).toBe('succeeded');

    const state = await store.readClaudeScheduledTaskSchedulerState();
    expect(state.tasks['task-1']?.lastScheduledFor).toBe('2026-06-15T10:00:00.000Z');
    expect(state.tasks['task-1']?.nextRunAt).toBe('2026-06-15T11:00:00.000Z');
  });

  it('recomputes nextRunAt after cronExpr is edited', async () => {
    const store = await import('@electron/services/claude-scheduled-task-store');
    const { ClaudeTaskScheduler, computeNextRunAt } = await import('@electron/services/claude-task-scheduler');

    const now = new Date('2026-06-15T08:30:00.000Z');

    await store.upsertClaudeScheduledTaskDefinition({
      id: 'task-edit',
      name: 'Editable task',
      enabled: true,
      cronExpr: '0 9 * * *',
      promptTemplate: 'do something',
      agentId: 'main',
      workspacePath: '/tmp/workspace',
      permissionProfile: 'readonly-safe',
      timeoutSec: 60,
      retryPolicy: { maxAttempts: 1, backoffSec: 30 },
      failurePolicy: { pauseAfterConsecutiveFailures: 3 },
      createdAt: '2026-06-15T00:00:00.000Z',
      updatedAt: '2026-06-15T00:00:00.000Z',
    });

    const scheduler = new ClaudeTaskScheduler(undefined, 60_000);

    // 旧 cron 首次调度：nextRunAt 落在未来
    const before = await scheduler.refreshSchedule(now);
    const oldNextRunAt = before[0].nextRunAt;
    expect(new Date(oldNextRunAt).getTime()).toBeGreaterThan(now.getTime());

    // 编辑 cronExpr 为更晚的时间，旧 nextRunAt 仍在未来但已与新计划无关
    const existing = await store.getClaudeScheduledTaskDefinition('task-edit');
    await store.upsertClaudeScheduledTaskDefinition({
      ...existing!,
      cronExpr: '0 14 * * *',
      updatedAt: now.toISOString(),
    });

    const after = await scheduler.refreshSchedule(now);
    const newNextRunAt = after[0].nextRunAt;

    // 必须重算为新 cron 的下次执行时间，而不是保留旧值
    expect(newNextRunAt).not.toBe(oldNextRunAt);
    expect(newNextRunAt).toBe(computeNextRunAt('0 14 * * *', now));

    // state 里也应落盘新值与新 cronExpr
    const state = await store.readClaudeScheduledTaskSchedulerState();
    expect(state.tasks['task-edit']?.nextRunAt).toBe(newNextRunAt);
    expect(state.tasks['task-edit']?.cronExpr).toBe('0 14 * * *');
  });
});
