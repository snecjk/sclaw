import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testRoot, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testRoot: `/tmp/stoclaw-claude-worker-root-${suffix}`,
    testUserData: `/tmp/stoclaw-claude-worker-user-data-${suffix}`,
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

describe('ClaudeTaskWorker', () => {
  beforeEach(async () => {
    vi.resetModules();
    await rm(testRoot, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('writes running and final run records for a manual trigger', async () => {
    const store = await import('@electron/services/claude-scheduled-task-store');
    const sessionStore = await import('@electron/services/claude-scheduled-task-session-store');
    const { ClaudeTaskWorker } = await import('@electron/services/claude-task-worker');

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

    const worker = new ClaudeTaskWorker(async ({ run }) => ({
      completedAt: '2026-06-15T00:01:00.000Z',
      status: 'succeeded',
      summary: `completed:${run.runId}`,
      runtimeResult: {
        stopReason: 'end_turn',
        isError: false,
        durationMs: 1000,
      },
    }));

    const result = await worker.runTask({
      taskId: 'task-1',
      triggerSource: 'manual',
    });

    expect(result.status).toBe('succeeded');
    expect(result.summary).toContain('completed:');

    const records = await store.listClaudeScheduledTaskRunRecords('task-1');
    expect(records).toHaveLength(2);
    expect(records[0]?.status).toBe('running');
    expect(records[1]?.status).toBe('succeeded');
    await expect(sessionStore.listClaudeScheduledTaskSummarySessions()).resolves.toHaveLength(1);
    const summaryMessages = await sessionStore.readClaudeScheduledTaskSessionHistory(
      sessionStore.buildClaudeTaskSummarySessionKey('task-1'),
    );
    expect(summaryMessages.some((message) => message.content.includes('completed:'))).toBe(true);
    await expect(store.getClaudeScheduledTaskLease('task-1')).resolves.toBeNull();
  });
});
