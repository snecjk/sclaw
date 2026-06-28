import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testRoot, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testRoot: `/tmp/stoclaw-claude-task-session-root-${suffix}`,
    testUserData: `/tmp/stoclaw-claude-task-session-user-data-${suffix}`,
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
  const actual = await vi.importActual<typeof import('../../electron/utils/paths')>(
    '../../electron/utils/paths'
  );
  return {
    ...actual,
    getClawXConfigDir: () => testRoot,
    getClaudeScheduledTasksDir: () => join(testRoot, 'claude-scheduled-tasks'),
  };
});

describe('claude scheduled task session store', () => {
  beforeEach(async () => {
    vi.resetModules();
    await rm(testRoot, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('persists summary sessions from completed runs', async () => {
    const sessionStore = await import('@electron/services/claude-scheduled-task-session-store');

    await sessionStore.appendClaudeScheduledTaskSummaryRun(
      {
        id: 'task-42',
        name: 'Morning digest',
        enabled: true,
        cronExpr: '0 9 * * *',
        promptTemplate: 'digest',
        agentId: 'main',
        workspacePath: '/tmp/workspace',
        permissionProfile: 'readonly-safe',
        timeoutSec: 60,
        retryPolicy: { maxAttempts: 1, backoffSec: 30 },
        failurePolicy: { pauseAfterConsecutiveFailures: 3 },
        createdAt: '2026-06-15T00:00:00.000Z',
        updatedAt: '2026-06-15T00:00:00.000Z',
      },
      {
        runId: 'run-1',
        taskId: 'task-42',
        status: 'succeeded',
        triggerSource: 'manual',
        scheduledFor: '2026-06-15T09:00:00.000Z',
        startedAt: '2026-06-15T09:00:01.000Z',
        completedAt: '2026-06-15T09:00:20.000Z',
        attempt: 1,
        idempotencyKey: 'task-42:2026-06-15T09:00:00.000Z:1',
        sessionKey: sessionStore.buildClaudeTaskRunSessionKey('task-42', 'run-1'),
        summary: 'digest ready',
        runtimeResult: {
          stopReason: 'end_turn',
          isError: false,
          durationMs: 19000,
        },
        runtimeSnapshot: {
          workspacePath: '/tmp/workspace',
          permissionProfile: 'readonly-safe',
          pluginPaths: [],
        },
      }
    );

    const sessions = await sessionStore.listClaudeScheduledTaskSummarySessions();
    expect(sessions).toHaveLength(2);
    const baseSession = sessions.find((s) => s.key === 'claude-task:task-42');
    const datedSession = sessions.find((s) => s.key === 'claude-task:task-42:2026-06-15');
    expect(baseSession).toBeDefined();
    expect(datedSession).toBeDefined();

    const history = await sessionStore.readClaudeScheduledTaskSessionHistory('claude-task:task-42');
    expect(history).toHaveLength(3);
    expect(history[0]?.role).toBe('user');
    expect(history[0]?.content).toBe('digest');
    expect(history[1]?.role).toBe('assistant');
    expect(history[1]?.content).toContain('digest ready');
    expect(history[2]?.role).toBe('system');
    expect(history[2]?.content).toContain('sessionKey: claude-task-run:task-42:run-1');
  });

  it('deletes summary sessions without touching other task stores', async () => {
    const sessionStore = await import('@electron/services/claude-scheduled-task-session-store');

    for (const taskId of ['task-a', 'task-b']) {
      await sessionStore.appendClaudeScheduledTaskSummaryRun(
        {
          id: taskId,
          name: `Task ${taskId}`,
          enabled: true,
          cronExpr: '0 9 * * *',
          promptTemplate: 'digest',
          agentId: 'main',
          workspacePath: '/tmp/workspace',
          permissionProfile: 'readonly-safe',
          timeoutSec: 60,
          retryPolicy: { maxAttempts: 1, backoffSec: 30 },
          failurePolicy: { pauseAfterConsecutiveFailures: 3 },
          createdAt: '2026-06-15T00:00:00.000Z',
          updatedAt: '2026-06-15T00:00:00.000Z',
        },
        {
          runId: `run-${taskId}`,
          taskId,
          status: 'failed',
          triggerSource: 'manual',
          scheduledFor: '2026-06-15T09:00:00.000Z',
          attempt: 1,
          idempotencyKey: `${taskId}:1`,
          sessionKey: sessionStore.buildClaudeTaskRunSessionKey(taskId, `run-${taskId}`),
          error: 'boom',
          runtimeSnapshot: {
            workspacePath: '/tmp/workspace',
            permissionProfile: 'readonly-safe',
            pluginPaths: [],
          },
        }
      );
    }

    await sessionStore.deleteClaudeScheduledTaskSummarySession('claude-task:task-a');

    const sessions = await sessionStore.listClaudeScheduledTaskSummarySessions();
    expect(sessions).toHaveLength(3);
    const remainingKeys = sessions.map((s) => s.key);
    expect(remainingKeys).toContain('claude-task:task-a:2026-06-15');
    expect(remainingKeys).toContain('claude-task:task-b');
    expect(remainingKeys).toContain('claude-task:task-b:2026-06-15');
  });

  it('deleteClaudeScheduledTaskSummarySession removes dated aggregate sessions', async () => {
    const taskId = 'task-dated';
    const datedKey = 'claude-task:task-dated:2026-06-25';
    const sessionStore = await import('@electron/services/claude-scheduled-task-session-store');

    await sessionStore.appendClaudeScheduledTaskSummaryRun(
      {
        id: taskId,
        name: 'Dated task',
        enabled: true,
        cronExpr: '0 9 * * *',
        promptTemplate: 'digest',
        agentId: 'main',
        workspacePath: '/tmp/workspace',
        permissionProfile: 'readonly-safe',
        timeoutSec: 60,
        retryPolicy: { maxAttempts: 1, backoffSec: 30 },
        failurePolicy: { pauseAfterConsecutiveFailures: 3 },
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
      {
        runId: 'run-1',
        taskId,
        status: 'succeeded',
        triggerSource: 'manual',
        scheduledFor: '2026-06-25T09:00:00.000Z',
        startedAt: '2026-06-25T09:00:01.000Z',
        completedAt: '2026-06-25T09:00:20.000Z',
        attempt: 1,
        idempotencyKey: `${taskId}:2026-06-25T09:00:00.000Z:1`,
        sessionKey: sessionStore.buildClaudeTaskRunSessionKey(taskId, 'run-1'),
        summary: 'dated digest',
        runtimeResult: {
          stopReason: 'end_turn',
          isError: false,
          durationMs: 19000,
        },
        runtimeSnapshot: {
          workspacePath: '/tmp/workspace',
          permissionProfile: 'readonly-safe',
          pluginPaths: [],
        },
      },
    );

    const beforeDelete = await sessionStore.listClaudeScheduledTaskSummarySessions();
    expect(beforeDelete.some((item) => item.key === datedKey)).toBe(true);

    await sessionStore.deleteClaudeScheduledTaskSummarySession(datedKey);
    const sessions = await sessionStore.listClaudeScheduledTaskSummarySessions();
    expect(sessions.some((item) => item.key === datedKey)).toBe(false);
    expect(sessions.some((item) => item.key === sessionStore.buildClaudeTaskSummarySessionKey(taskId))).toBe(true);
  });
});
