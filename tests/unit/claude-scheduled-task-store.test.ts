import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testRoot, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testRoot: `/tmp/stoclaw-claude-task-root-${suffix}`,
    testUserData: `/tmp/stoclaw-claude-task-user-data-${suffix}`,
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

describe('claude scheduled task store', () => {
  beforeEach(async () => {
    vi.resetModules();
    await rm(testRoot, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('persists and deletes task definitions', async () => {
    const store = await import('@electron/services/claude-scheduled-task-store');

    const definition: import('@electron/services/claude-scheduled-task-store').ClaudeScheduledTaskDefinition = {
      id: 'task-1',
      name: 'Daily summary',
      enabled: true,
      cronExpr: '0 9 * * *',
      promptTemplate: 'Summarize daily sales',
      agentId: 'main',
      workspacePath: '/tmp/workspace',
      providerAccountId: 'anthropic-default',
      model: 'claude-sonnet-4-20250514',
      permissionProfile: 'readonly-safe',
      timeoutSec: 300,
      retryPolicy: {
        maxAttempts: 2,
        backoffSec: 30,
      },
      failurePolicy: {
        pauseAfterConsecutiveFailures: 3,
      },
      createdAt: '2026-06-15T00:00:00.000Z',
      updatedAt: '2026-06-15T00:00:00.000Z',
    };

    await store.upsertClaudeScheduledTaskDefinition(definition);
    await expect(store.getClaudeScheduledTaskDefinition('task-1')).resolves.toEqual(definition);
    await expect(store.listClaudeScheduledTaskDefinitions()).resolves.toEqual([definition]);

    await expect(store.deleteClaudeScheduledTaskDefinition('task-1')).resolves.toEqual(definition);
    await expect(store.listClaudeScheduledTaskDefinitions()).resolves.toEqual([]);
  });

  it('persists scheduler state and leases in the dedicated local directory', async () => {
    const store = await import('@electron/services/claude-scheduled-task-store');

    await store.writeClaudeScheduledTaskSchedulerState({
      lastTickAt: '2026-06-15T01:00:00.000Z',
      tasks: {
        'task-1': {
          nextRunAt: '2026-06-16T01:00:00.000Z',
          lastScheduledFor: '2026-06-15T01:00:00.000Z',
        },
      },
    });
    await store.upsertClaudeScheduledTaskLease({
      taskId: 'task-1',
      runId: 'run-1',
      leaseUntil: '2026-06-15T01:05:00.000Z',
    });

    await expect(store.readClaudeScheduledTaskSchedulerState()).resolves.toEqual({
      lastTickAt: '2026-06-15T01:00:00.000Z',
      tasks: {
        'task-1': {
          nextRunAt: '2026-06-16T01:00:00.000Z',
          lastScheduledFor: '2026-06-15T01:00:00.000Z',
        },
      },
    });
    await expect(store.getClaudeScheduledTaskLease('task-1')).resolves.toEqual({
      taskId: 'task-1',
      runId: 'run-1',
      leaseUntil: '2026-06-15T01:05:00.000Z',
    });

    const statePath = join(testRoot, 'claude-scheduled-tasks', 'scheduler-state.json');
    const leasePath = join(testRoot, 'claude-scheduled-tasks', 'leases.json');
    await expect(readFile(statePath, 'utf8')).resolves.toContain('"task-1"');
    await expect(readFile(leasePath, 'utf8')).resolves.toContain('"runId": "run-1"');
  });

  it('appends and reads task run records in jsonl format', async () => {
    const store = await import('@electron/services/claude-scheduled-task-store');

    await store.appendClaudeScheduledTaskRunRecord({
      runId: 'run-1',
      taskId: 'task-1',
      status: 'succeeded',
      triggerSource: 'manual',
      scheduledFor: '2026-06-15T02:00:00.000Z',
      startedAt: '2026-06-15T02:00:01.000Z',
      completedAt: '2026-06-15T02:00:05.000Z',
      attempt: 1,
      idempotencyKey: 'task-1:2026-06-15T02:00:00.000Z:1',
      sessionKey: 'claude-task-run:task-1:run-1',
      summary: 'Completed successfully',
      runtimeResult: {
        stopReason: 'end_turn',
        isError: false,
        durationMs: 4000,
      },
      runtimeSnapshot: {
        workspacePath: '/tmp/workspace',
        providerAccountId: 'anthropic-default',
        model: 'claude-sonnet-4-20250514',
        permissionProfile: 'readonly-safe',
        pluginPaths: ['/tmp/plugin-a'],
      },
    });

    await store.appendClaudeScheduledTaskRunRecord({
      runId: 'run-2',
      taskId: 'task-1',
      status: 'failed',
      triggerSource: 'schedule',
      scheduledFor: '2026-06-16T02:00:00.000Z',
      attempt: 1,
      idempotencyKey: 'task-1:2026-06-16T02:00:00.000Z:1',
      sessionKey: 'claude-task-run:task-1:run-2',
      error: 'timeout',
      runtimeSnapshot: {
        workspacePath: '/tmp/workspace',
        permissionProfile: 'readonly-safe',
        pluginPaths: [],
      },
    });

    const records = await store.listClaudeScheduledTaskRunRecords('task-1');
    expect(records).toHaveLength(2);
    expect(records[0]?.runId).toBe('run-1');
    expect(records[1]?.runId).toBe('run-2');

    await expect(store.getLatestClaudeScheduledTaskRunRecord('task-1')).resolves.toMatchObject({
      runId: 'run-2',
      status: 'failed',
    });
  });
});
