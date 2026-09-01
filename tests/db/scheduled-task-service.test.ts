import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupInMemoryDb, type InMemoryDb } from './helpers';
import {
  ScheduledTaskService,
  DINGTALK_RECIPIENTS_MARKER,
} from '../../electron/scheduled-tasks/scheduled-task-service';
import { SCHEDULED_TASK_DINGTALK_RULES } from '../../shared/dingtalk-prompts';
import type { DingTalkMention } from '../../shared/dingtalk-send/dingtalk-mention';
import { ScheduleTaskRunRepository } from '../../electron/db/repositories/schedule-task-run-repository';

const getAuthState = vi.fn(async () => ({ user: null as { code: string } | null }));
const getStoToken = vi.fn(async () => 'test-token' as string | null);
vi.mock('../../electron/utils/auth-store', () => ({
  getAuthState: () => getAuthState(),
  getStoToken: () => getStoToken(),
}));

const baseCreateInput = {
  name: 'Daily standup',
  cronExpr: '0 9 * * *',
  engineType: 'claude' as const,
  prompt: 'summarize overnight activity',
  agentId: 'agent-1',
};

describe('ScheduledTaskService', () => {
  let env: InMemoryDb;
  let svc: ScheduledTaskService;

  beforeEach(() => {
    env = setupInMemoryDb();
    svc = new ScheduledTaskService();
    getAuthState.mockReset();
    getAuthState.mockResolvedValue({ user: null });
    getStoToken.mockReset();
    getStoToken.mockResolvedValue('test-token');
  });

  afterEach(() => env.teardown());

  describe('createTask', () => {
    it('persists a task with normalized retry/failure defaults and a computed nextRunAt', async () => {
      const task = await svc.createTask(baseCreateInput);
      expect(task.id).toBeTruthy();
      expect(task.retryPolicy).toEqual({ maxAttempts: 1, backoffSec: 30 });
      expect(task.failurePolicy).toEqual({ pauseAfterConsecutiveFailures: 3 });
      expect(task.cronExprSnapshot).toBe('0 9 * * *');
      expect(task.nextRunAt).toBeTruthy();
      expect(new Date(task.nextRunAt!).getTime()).toBeGreaterThan(Date.now() - 60_000);
    });

    it('fills createdBy/updatedBy from auth when actor is omitted (Claude NL path)', async () => {
      getAuthState.mockResolvedValue({ user: { code: '1165828' } });
      const task = await svc.createTask(baseCreateInput);
      expect(task.createdBy).toBe('1165828');
      expect(task.updatedBy).toBe('1165828');
    });

    it('keeps explicit actor null (migration / Host API unauthenticated)', async () => {
      getAuthState.mockResolvedValue({ user: { code: '1165828' } });
      const task = await svc.createTask({ ...baseCreateInput, actor: null });
      expect(task.createdBy).toBeNull();
      expect(task.updatedBy).toBeNull();
    });

    it('rejects missing required fields', async () => {
      await expect(svc.createTask({ ...baseCreateInput, name: '' })).rejects.toThrow(/name is required/);
      await expect(svc.createTask({ ...baseCreateInput, prompt: '' })).rejects.toThrow(/prompt is required/);
      await expect(svc.createTask({ ...baseCreateInput, agentId: '' })).rejects.toThrow(/agentId is required/);
      await expect(svc.createTask({ ...baseCreateInput, cronExpr: '' })).rejects.toThrow(/cronExpr is required/);
    });

    it('rejects invalid cron expressions', async () => {
      await expect(svc.createTask({ ...baseCreateInput, cronExpr: 'bad' })).rejects.toThrow(/cron/);
      await expect(svc.createTask({ ...baseCreateInput, cronExpr: '0 9 31 2 *' })).rejects.toThrow(/scan horizon/);
    });

    it('rejects invalid permission profiles', async () => {
      await expect(
        svc.createTask({ ...baseCreateInput, permissionProfile: 'bogus' as never }),
      ).rejects.toThrow(/Invalid permissionProfile/);
    });

    it('rejects invalid retry/failure/timeout policies', async () => {
      await expect(
        svc.createTask({ ...baseCreateInput, retryPolicy: { maxAttempts: 0, backoffSec: 30 } }),
      ).rejects.toThrow(/maxAttempts/);
      await expect(
        svc.createTask({ ...baseCreateInput, retryPolicy: { maxAttempts: 1, backoffSec: -1 } }),
      ).rejects.toThrow(/backoffSec/);
      await expect(
        svc.createTask({ ...baseCreateInput, failurePolicy: { pauseAfterConsecutiveFailures: 0 } }),
      ).rejects.toThrow(/pauseAfterConsecutiveFailures/);
      await expect(svc.createTask({ ...baseCreateInput, timeoutSec: 0 })).rejects.toThrow(/timeoutSec/);
    });
  });

  describe('ensureDatedSessionPlaceholder', () => {
    it('writes a cron-typed catalog row for openclaw and a claude_task-typed row for claude', async () => {
      const date = new Date('2024-01-15T03:00:00.000Z');

      const openTask = await svc.createTask({ ...baseCreateInput, name: 'Open Task', engineType: 'openclaw' });
      const openSession = await svc.ensureDatedSessionPlaceholder(openTask, date);
      expect(openSession.sessionType).toBe('cron');
      expect(openSession.taskId).toBe(openTask.id);
      expect(openSession.title).toBe('Open Task');
      expect(openSession.sessionKey).toMatch(/^agent:agent-1:cron:[^:]+:/);

      const claudeTask = await svc.createTask({ ...baseCreateInput, name: 'Claude Task', engineType: 'claude' });
      const claudeSession = await svc.ensureDatedSessionPlaceholder(claudeTask, date);
      expect(claudeSession.sessionType).toBe('claude_task');
      expect(claudeSession.taskId).toBe(claudeTask.id);
      expect(claudeSession.sessionKey).toMatch(/^claude-task:[^:]+:/);
    });

    it('is idempotent: re-upserting the same date reuses the same session row', async () => {
      const task = await svc.createTask(baseCreateInput);
      const date = new Date('2024-01-15T03:00:00.000Z');
      const first = await svc.ensureDatedSessionPlaceholder(task, date);
      const second = await svc.ensureDatedSessionPlaceholder(task, date);
      expect(second.sessionKey).toBe(first.sessionKey);
      expect(second.taskId).toBe(first.taskId);
    });
  });

  describe('buildExecutionSystemPromptAppend', () => {
    it('returns null when there are no recipients', async () => {
      const task = await svc.createTask(baseCreateInput);
      expect(svc.buildExecutionSystemPromptAppend(task)).toBeNull();
    });

    it('returns null when recipients are unresolved (user without userId)', async () => {
      const unresolved: DingTalkMention[] = [{ type: 'user', displayName: 'Ghost' }];
      const task = await svc.createTask({ ...baseCreateInput, dingtalkRecipients: unresolved });
      expect(svc.buildExecutionSystemPromptAppend(task)).toBeNull();
    });

    it('bakes recipients block + 模块 C when recipients are resolved from column', async () => {
      const recipients: DingTalkMention[] = [
        { type: 'user', displayName: 'Lei', userId: 'u-lei' },
      ];
      const task = await svc.createTask({ ...baseCreateInput, dingtalkRecipients: recipients });
      const append = svc.buildExecutionSystemPromptAppend(task);
      expect(append).not.toBeNull();
      expect(append).toContain(DINGTALK_RECIPIENTS_MARKER);
      expect(append).toContain('指定即必发');
      expect(append).toContain('不要假设系统会自动发');
      expect(append).toContain('u-lei');
      expect(append).not.toContain('系统自动发送');
      // 列收件人路径须带上模块 C（禁询问），避免 Claude 首跑改成请示
      expect(append).toContain(SCHEDULED_TASK_DINGTALK_RULES);
      expect(append).toContain('禁止在发送前询问');
    });

    it('resolves recipients from prompt block when column is empty', async () => {
      const { appendDingTalkMentionContext } = await import('../../shared/dingtalk-prompts/dingtalk-mention-context');
      const prompt = appendDingTalkMentionContext('生成日报', [
        { type: 'user', displayName: 'Lei', userId: 'u-from-prompt' },
      ], { scenario: 'scheduled-task' });
      const task = await svc.createTask({ ...baseCreateInput, prompt, dingtalkRecipients: null });
      const append = svc.buildExecutionSystemPromptAppend(task);
      expect(append).toContain('u-from-prompt');
      expect(append).toContain('指定即必发');
      expect(append).toContain(SCHEDULED_TASK_DINGTALK_RULES);
      expect(append).toContain('禁止在发送前询问');
    });

    it('uses agent 必发 rules when task prompt involves workflow and recipients are resolved', async () => {
      const recipients: DingTalkMention[] = [
        { type: 'user', displayName: 'Lei', userId: 'u-lei' },
      ];
      const task = await svc.createTask({
        ...baseCreateInput,
        prompt: '帮我执行 id 为：wf_daily 的工作流 【日报】',
        dingtalkRecipients: recipients,
      });
      const append = svc.buildExecutionSystemPromptAppend(task);
      expect(append).toContain('u-lei');
      expect(append).toContain('指定即必发');
      expect(append).toContain('不要假设系统会自动发');
      expect(append).not.toContain('系统自动发送');
      expect(append).toContain('dws chat message send --user u-lei');
      expect(append).toContain(SCHEDULED_TASK_DINGTALK_RULES);
      expect(append).toContain('禁止在发送前询问');
    });
  });

  describe('updateTask extra merge', () => {
    it('preserves extra.createdVia when incoming extra omits it', async () => {
      getAuthState.mockResolvedValue({ user: { code: '1165828' } });
      const created = await svc.createTask({
        ...baseCreateInput,
        extra: {
          createdVia: 'nl',
          composerSegments: [{ type: 'text', text: 'old' }],
        },
      });
      expect(created.extra?.createdVia).toBe('nl');

      const updated = await svc.updateTask(created.id, {
        prompt: 'new prompt',
        extra: {
          composerSegments: [{ type: 'text', text: 'new' }],
        },
      });
      expect(updated?.extra?.createdVia).toBe('nl');
      expect(updated?.extra?.composerSegments).toEqual([{ type: 'text', text: 'new' }]);
    });
  });

  describe('setEnabled / deleteTask', () => {
    beforeEach(() => {
      getAuthState.mockResolvedValue({ user: { code: '1165828' } });
    });

    it('toggling enabled off nulls nextRunAt and back on recomputes it', async () => {
      const task = await svc.createTask(baseCreateInput);
      expect(task.nextRunAt).toBeTruthy();

      const off = await svc.setEnabled(task.id, false);
      expect(off?.nextRunAt).toBeNull();

      const on = await svc.setEnabled(task.id, true);
      expect(on?.nextRunAt).toBeTruthy();
    });

    it('deleteTask soft-deletes the row so getTask/listTasks no longer see it', async () => {
      const task = await svc.createTask(baseCreateInput);
      await svc.deleteTask(task.id);
      expect(await svc.getTask(task.id)).toBeNull();
      expect(await svc.listTasks()).toHaveLength(0);
    });

    it('disabling cancels queued runs and nulls nextRunAt', async () => {
      const task = await svc.createTask(baseCreateInput);
      const runRepo = new ScheduleTaskRunRepository();
      const run = await runRepo.createRun({
        taskId: task.id,
        triggerSource: 'schedule',
        idempotencyKey: `${task.id}:queued-disable`,
        status: 'queued',
      });

      await svc.setEnabled(task.id, false);

      expect((await runRepo.getRun(run.runId))?.status).toBe('cancelled');
      expect((await svc.getTask(task.id))?.nextRunAt).toBeNull();
    });

    it('deleting cancels queued runs', async () => {
      const task = await svc.createTask(baseCreateInput);
      const runRepo = new ScheduleTaskRunRepository();
      const run = await runRepo.createRun({
        taskId: task.id,
        triggerSource: 'schedule',
        idempotencyKey: `${task.id}:queued-delete`,
        status: 'queued',
      });

      await svc.deleteTask(task.id);

      expect((await runRepo.getRun(run.runId))?.status).toBe('cancelled');
      expect((await runRepo.getRun(run.runId))?.error).toBe('task deleted');
    });

    it('rejects unauthenticated mutate on orphan tasks', async () => {
      getAuthState.mockResolvedValue({ user: null });
      const orphan = await svc.createTask({ ...baseCreateInput, actor: null });
      await expect(svc.deleteTask(orphan.id, null)).rejects.toThrow(/无权删除/);
      await expect(svc.setEnabled(orphan.id, false, null)).rejects.toThrow(/无权修改/);
      await expect(svc.triggerTask(orphan.id)).rejects.toThrow(/无权触发/);
    });
  });

  describe('ownership isolation (scheme A)', () => {
    it('listTasks only returns current user tasks', async () => {
      await svc.createTask({ ...baseCreateInput, name: 'A task', actor: 'user-a' });
      await svc.createTask({ ...baseCreateInput, name: 'B task', actor: 'user-b' });

      getAuthState.mockResolvedValue({ user: { code: 'user-b' } });
      const listed = await svc.listTasks();
      expect(listed.map((t) => t.name)).toEqual(['B task']);
    });

    it('listTasks matches created_by with surrounding whitespace via trim', async () => {
      await svc.createTask({ ...baseCreateInput, name: 'spaced', actor: '  user-a  ' });
      getAuthState.mockResolvedValue({ user: { code: ' user-a ' } });
      const listed = await svc.listTasks();
      expect(listed.map((t) => t.name)).toEqual(['spaced']);
      expect(listed[0]?.createdBy).toBe('user-a');
    });

    it('rejects update/delete/setEnabled/trigger on another user task', async () => {
      const aTask = await svc.createTask({ ...baseCreateInput, name: 'A only', actor: 'user-a' });
      getAuthState.mockResolvedValue({ user: { code: 'user-b' } });

      await expect(svc.updateTask(aTask.id, { name: 'hijack', actor: 'user-b' })).rejects.toThrow(
        /无权修改/,
      );
      await expect(svc.setEnabled(aTask.id, false, 'user-b')).rejects.toThrow(/无权修改/);
      await expect(svc.deleteTask(aTask.id, 'user-b')).rejects.toThrow(/无权删除/);
      await expect(svc.triggerTask(aTask.id)).rejects.toThrow(/无权触发/);
      expect(await svc.getTask(aTask.id)).toBeNull();
    });

    it('scheduler tick with owner only fires that user tasks', async () => {
      const { ScheduledTaskScheduler } = await import(
        '../../electron/scheduled-tasks/scheduled-task-scheduler'
      );
      const { ScheduleTaskRepository } = await import(
        '../../electron/db/repositories/schedule-task-repository'
      );
      const { ScheduleTaskRunRepository } = await import(
        '../../electron/db/repositories/schedule-task-run-repository'
      );
      const taskRepo = new ScheduleTaskRepository();
      const runRepo = new ScheduleTaskRunRepository();
      const dispatched: string[] = [];
      const scheduler = new ScheduledTaskScheduler(taskRepo, runRepo, {
        async dispatch({ task }) {
          dispatched.push(task.name);
        },
      });

      const past = new Date(Date.now() - 5_000).toISOString();
      const a = await taskRepo.create({
        ...baseCreateInput,
        name: 'owner-a',
        actor: 'user-a',
        cronExpr: '* * * * *',
      });
      const b = await taskRepo.create({
        ...baseCreateInput,
        name: 'owner-b',
        actor: 'user-b',
        cronExpr: '* * * * *',
      });
      await taskRepo.updateScheduleState(a.id, { nextRunAt: past, cronExprSnapshot: '* * * * *' });
      await taskRepo.updateScheduleState(b.id, { nextRunAt: past, cronExprSnapshot: '* * * * *' });

      scheduler.setOwnerUserCode('user-b');
      await scheduler.tick(new Date());
      expect(dispatched).toEqual(['owner-b']);
    });

    it('discardMissedOnStartup with owner only cancels that user queued runs', async () => {
      const { ScheduledTaskScheduler } = await import(
        '../../electron/scheduled-tasks/scheduled-task-scheduler'
      );
      const { ScheduleTaskRepository } = await import(
        '../../electron/db/repositories/schedule-task-repository'
      );
      const { ScheduleTaskRunRepository } = await import(
        '../../electron/db/repositories/schedule-task-run-repository'
      );
      const taskRepo = new ScheduleTaskRepository();
      const runRepo = new ScheduleTaskRunRepository();
      const scheduler = new ScheduledTaskScheduler(taskRepo, runRepo);

      const a = await taskRepo.create({ ...baseCreateInput, name: 'A', actor: 'user-a' });
      const b = await taskRepo.create({ ...baseCreateInput, name: 'B', actor: 'user-b' });
      const runA = await runRepo.createRun({
        taskId: a.id,
        triggerSource: 'schedule',
        idempotencyKey: `${a.id}:q`,
        status: 'queued',
      });
      const runB = await runRepo.createRun({
        taskId: b.id,
        triggerSource: 'schedule',
        idempotencyKey: `${b.id}:q`,
        status: 'queued',
      });

      scheduler.setOwnerUserCode('user-b');
      await scheduler.discardMissedOnStartup(new Date());

      expect((await runRepo.getRun(runA.runId))?.status).toBe('queued');
      expect((await runRepo.getRun(runB.runId))?.status).toBe('cancelled');
    });
  });
});
