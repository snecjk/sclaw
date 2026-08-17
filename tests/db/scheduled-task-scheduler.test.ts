import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupInMemoryDb, type InMemoryDb } from './helpers';
import { ScheduleTaskRepository } from '../../electron/db/repositories/schedule-task-repository';
import { ScheduleTaskRunRepository } from '../../electron/db/repositories/schedule-task-run-repository';
import {
  ScheduledTaskScheduler,
  type ScheduledTaskDispatcher,
} from '../../electron/scheduled-tasks/scheduled-task-scheduler';
import { validateCronExpr, computeNextRunAt } from '../../electron/scheduled-tasks/cron-math';
import type { ScheduleTask, ScheduleTaskRun } from '../../electron/db/models/domain/schedule-task';

function makeRecordingDispatcher() {
  const dispatched: Array<{ task: ScheduleTask; run: ScheduleTaskRun }> = [];
  const dispatcher: ScheduledTaskDispatcher = {
    async dispatch({ task, run }) {
      dispatched.push({ task, run });
    },
  };
  return { dispatcher, dispatched };
}

const baseTaskInput = {
  engineType: 'claude' as const,
  prompt: 'do something',
  agentId: 'agent-1',
  cronExpr: '* * * * *',
};

describe('ScheduledTaskScheduler', () => {
  let env: InMemoryDb;
  let taskRepo: ScheduleTaskRepository;
  let runRepo: ScheduleTaskRunRepository;

  beforeEach(() => {
    env = setupInMemoryDb();
    taskRepo = new ScheduleTaskRepository();
    runRepo = new ScheduleTaskRunRepository();
  });

  afterEach(() => env.teardown());

  describe('validateCronExpr', () => {
    it('accepts well-formed 5-field expressions', () => {
      expect(() => validateCronExpr('* * * * *')).not.toThrow();
      expect(() => validateCronExpr('0 9 * * *')).not.toThrow();
      expect(() => validateCronExpr('*/5 * * * *')).not.toThrow();
      expect(() => validateCronExpr('0 0 1 * *')).not.toThrow();
      expect(() => validateCronExpr('0 9 * * 1-5')).not.toThrow();
    });

    it('rejects malformed field counts', () => {
      expect(() => validateCronExpr('* * *')).toThrow(/5-field cron/);
      expect(() => validateCronExpr('0 9 * *')).toThrow(/5-field cron/);
      expect(() => validateCronExpr('0 9 * * * *')).toThrow(/5-field cron/);
    });

    it('rejects out-of-range values', () => {
      expect(() => validateCronExpr('60 * * * *')).toThrow(/Invalid cron/);
      expect(() => validateCronExpr('0 25 * * *')).toThrow(/Invalid cron/);
      expect(() => validateCronExpr('0 9 32 * *')).toThrow(/Invalid cron/);
      expect(() => validateCronExpr('0 9 0 * *')).toThrow(/Invalid cron/);
      expect(() => validateCronExpr('0 9 * 13 *')).toThrow(/Invalid cron/);
    });

    it('rejects expressions that never match within the scan horizon (e.g. Feb 31)', () => {
      expect(() => validateCronExpr('0 9 31 2 *')).toThrow(/scan horizon/);
    });

    it('stores nextRunAt as UTC ISO while matching host-local cron fields', () => {
      // 08:30 本机墙钟 → 当天 09:00 本机墙钟；ISO 带 Z 只是存储，不把 9 点当成 UTC 9 点。
      const from = new Date(2024, 5, 15, 8, 30, 0);
      const next = computeNextRunAt('0 9 * * *', from);
      expect(next).toMatch(/Z$/);
      const parsed = new Date(next);
      expect(parsed.getHours()).toBe(9);
      expect(parsed.getMinutes()).toBe(0);
      expect(parsed.getDate()).toBe(15);
      expect(parsed.getMonth()).toBe(5);
    });
  });

  describe('refreshSchedule', () => {
    it('computes nextRunAt for enabled tasks and nulls it for disabled ones', async () => {
      const now = new Date('2024-01-01T00:00:30.000Z');
      await taskRepo.create({ id: 'enabled', name: 'E', enabled: true, ...baseTaskInput });
      await taskRepo.create({ id: 'disabled', name: 'D', enabled: false, ...baseTaskInput });

      const snaps = await new ScheduledTaskScheduler(
        taskRepo,
        runRepo,
      ).refreshSchedule(now);

      expect(snaps.find((s) => s.taskId === 'enabled')?.nextRunAt).toBe(
        '2024-01-01T00:01:00.000Z',
      );
      expect(snaps.find((s) => s.taskId === 'disabled')?.nextRunAt).toBeNull();

      const enabled = await taskRepo.getById('enabled');
      expect(enabled?.nextRunAt).toBe('2024-01-01T00:01:00.000Z');
      expect(enabled?.cronExprSnapshot).toBe('* * * * *');

      const disabled = await taskRepo.getById('disabled');
      expect(disabled?.nextRunAt).toBeNull();
    });

    it('recomputes nextRunAt when the cron expression is edited (snapshot mismatch)', async () => {
      // Cron math is local-time based (getHours/getMinutes, ported verbatim from the
      // claude scheduler), so the absolute ISO depends on the runner's tz. Assert the
      // tz-independent invariant instead: editing hour 9 → 10 shifts nextRunAt by +1h
      // and the snapshot tracks the new cron.
      const now = new Date('2024-01-01T00:00:00.000Z');
      const scheduler = new ScheduledTaskScheduler(taskRepo, runRepo);
      await taskRepo.create({ id: 'cron-edit', name: 'C', enabled: true, ...baseTaskInput, cronExpr: '0 9 * * *' });
      await scheduler.refreshSchedule(now);
      const before = await taskRepo.getById('cron-edit');
      expect(before?.nextRunAt).toBeTruthy();
      expect(before?.cronExprSnapshot).toBe('0 9 * * *');

      // Simulate a cron edit: cron_expr changes, snapshot stays at the old value.
      await taskRepo.update('cron-edit', { cronExpr: '0 10 * * *' });
      const mid = await taskRepo.getById('cron-edit');
      expect(mid?.cronExprSnapshot).toBe('0 9 * * *'); // unchanged by update()

      await scheduler.refreshSchedule(now);
      const after = await taskRepo.getById('cron-edit');
      expect(after?.nextRunAt).toBeTruthy();
      expect(after?.cronExprSnapshot).toBe('0 10 * * *');
      const delta = new Date(after!.nextRunAt!).getTime() - new Date(before!.nextRunAt!).getTime();
      expect(delta).toBe(60 * 60 * 1000); // hour 9 → 10 = +1h, tz-independent
    });
  });

  describe('tick (single-flight)', () => {
    it('dispatches a due task exactly once and advances nextRunAt', async () => {
      const { dispatcher, dispatched } = makeRecordingDispatcher();
      const scheduler = new ScheduledTaskScheduler(taskRepo, runRepo, dispatcher);
      await taskRepo.create({ id: 'sf', name: 'SF', enabled: true, ...baseTaskInput });
      await scheduler.refreshSchedule(new Date('2024-01-01T00:00:30.000Z'));

      // nextRunAt=00:01:00; tick at 00:01:30 → due → dispatch run #1, advance to 00:02:00.
      await scheduler.tick(new Date('2024-01-01T00:01:30.000Z'));
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0].run.triggerSource).toBe('schedule');
      expect(dispatched[0].run.scheduledFor).toBe('2024-01-01T00:01:00.000Z');
      expect(dispatched[0].run.status).toBe('queued');
      expect((await taskRepo.getById('sf'))?.nextRunAt).toBe('2024-01-01T00:02:00.000Z');

      // 2nd tick while run #1 still 'queued' → busy path: no 2nd dispatch, advance past now.
      await scheduler.tick(new Date('2024-01-01T00:02:30.000Z'));
      expect(dispatched).toHaveLength(1);
      expect((await taskRepo.getById('sf'))?.nextRunAt).toBe('2024-01-01T00:03:00.000Z');
    });

    it('does not dispatch a not-yet-due task', async () => {
      const { dispatcher, dispatched } = makeRecordingDispatcher();
      const scheduler = new ScheduledTaskScheduler(taskRepo, runRepo, dispatcher);
      await taskRepo.create({ id: 'future', name: 'F', enabled: true, ...baseTaskInput });
      await scheduler.refreshSchedule(new Date('2024-01-01T00:00:30.000Z')); // nextRunAt=00:01:00

      await scheduler.tick(new Date('2024-01-01T00:00:45.000Z')); // not due
      expect(dispatched).toHaveLength(0);
      expect((await taskRepo.getById('future'))?.nextRunAt).toBe('2024-01-01T00:01:00.000Z');
    });

    it('still dispatches when due within the stale grace window', async () => {
      const { dispatcher, dispatched } = makeRecordingDispatcher();
      const scheduler = new ScheduledTaskScheduler(taskRepo, runRepo, dispatcher);
      await taskRepo.create({ id: 'grace', name: 'G', enabled: true, ...baseTaskInput });
      await scheduler.refreshSchedule(new Date('2024-01-01T00:00:30.000Z')); // nextRunAt=00:01:00

      // 20s late < default 60s grace → still fire
      await scheduler.tick(new Date('2024-01-01T00:01:20.000Z'));
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0].run.scheduledFor).toBe('2024-01-01T00:01:00.000Z');
    });

    it('discards a due slot that is older than the stale grace window', async () => {
      const { dispatcher, dispatched } = makeRecordingDispatcher();
      const scheduler = new ScheduledTaskScheduler(taskRepo, runRepo, dispatcher);
      await taskRepo.create({ id: 'stale', name: 'S', enabled: true, ...baseTaskInput });
      await scheduler.refreshSchedule(new Date('2024-01-01T00:00:30.000Z')); // nextRunAt=00:01:00

      // 4 minutes late > 60s grace → skip, advance from now
      const now = new Date('2024-01-01T00:05:00.000Z');
      await scheduler.tick(now);
      expect(dispatched).toHaveLength(0);
      const after = await taskRepo.getById('stale');
      expect(after?.nextRunAt).toBe('2024-01-01T00:06:00.000Z');
      expect(after?.lastRecoveredAt).toBe(now.toISOString());
    });
  });

  describe('tick (stale-run reaper)', () => {
    it('reaps a running run past its timeout_sec and releases single-flight', async () => {
      const { dispatcher, dispatched } = makeRecordingDispatcher();
      const scheduler = new ScheduledTaskScheduler(taskRepo, runRepo, dispatcher);
      await taskRepo.create({ id: 'hang', name: 'H', enabled: true, ...baseTaskInput, timeoutSec: 60 });

      // Started 120s ago with a 60s timeout → stale by 60s.
      const startedAt = '2024-01-01T00:00:00.000Z';
      const now = new Date('2024-01-01T00:02:00.000Z');
      const run = await runRepo.createRun({
        taskId: 'hang',
        triggerSource: 'schedule',
        scheduledFor: startedAt,
        status: 'running',
        startedAt,
        idempotencyKey: 'hang:2024-01-01T00:00:00.000Z',
      });
      // Keep the task not-due so tick won't claim a fresh run in the same pass.
      await taskRepo.updateScheduleState('hang', { nextRunAt: '2024-01-01T00:10:00.000Z' });

      await scheduler.tick(now);

      const reaped = await runRepo.getRun(run.runId);
      expect(reaped?.status).toBe('timed_out');
      expect(reaped?.completedAt).toBe(now.toISOString());
      expect(reaped?.error).toMatch(/timeout_sec=60/);
      expect(reaped?.runtimeResult?.stopReason).toBe('timeout');
      expect(reaped?.runtimeResult?.isError).toBe(true);
      expect(reaped?.runtimeResult?.durationMs).toBe(120_000);
      expect(await runRepo.getActiveRun('hang')).toBeNull();

      // Single-flight released: a fresh manual claim now succeeds.
      await scheduler.triggerTaskNow('hang', now);
      expect(dispatched).toHaveLength(1);
    });

    it('does not reap a running run still within its timeout_sec', async () => {
      const scheduler = new ScheduledTaskScheduler(
        taskRepo,
        runRepo,
        makeRecordingDispatcher().dispatcher,
      );
      await taskRepo.create({ id: 'fresh', name: 'F', enabled: true, ...baseTaskInput, timeoutSec: 60 });
      const startedAt = '2024-01-01T00:01:50.000Z'; // 10s elapsed, 60s timeout → still fresh
      const now = new Date('2024-01-01T00:02:00.000Z');
      const run = await runRepo.createRun({
        taskId: 'fresh',
        triggerSource: 'schedule',
        scheduledFor: startedAt,
        status: 'running',
        startedAt,
        idempotencyKey: 'fresh:2024-01-01T00:01:50.000Z',
      });
      await taskRepo.updateScheduleState('fresh', { nextRunAt: '2024-01-01T00:10:00.000Z' });

      await scheduler.tick(now);

      const untouched = await runRepo.getRun(run.runId);
      expect(untouched?.status).toBe('running');
      const active = await runRepo.getActiveRun('fresh');
      expect(active?.runId).toBe(run.runId);
      expect(active?.status).toBe('running');
    });

    it('skips reaping when the task has no timeout_sec', async () => {
      const scheduler = new ScheduledTaskScheduler(
        taskRepo,
        runRepo,
        makeRecordingDispatcher().dispatcher,
      );
      await taskRepo.create({ id: 'notmo', name: 'N', enabled: true, ...baseTaskInput }); // timeoutSec null
      const startedAt = '2024-01-01T00:00:00.000Z';
      const now = new Date('2024-01-01T01:00:00.000Z'); // 1h elapsed, but no timeout → cannot judge
      const run = await runRepo.createRun({
        taskId: 'notmo',
        triggerSource: 'schedule',
        scheduledFor: startedAt,
        status: 'running',
        startedAt,
        idempotencyKey: 'notmo:2024-01-01T00:00:00.000Z',
      });
      await taskRepo.updateScheduleState('notmo', { nextRunAt: '2024-01-02T00:00:00.000Z' });

      await scheduler.tick(now);

      expect((await runRepo.getRun(run.runId))?.status).toBe('running');
    });

    it('finalizeRunIfRunning is a one-shot guard: second caller loses without overwriting', async () => {
      // 双重 finalize 守卫：watcher(onTerminal/onTimeout) 与 reaper 都经
      // finalizeRunIfRunning。先到者赢（status running→终态，返回更新行），后到者
      // status≠running→返回 null 退出，不覆盖。防 watcher 已 succeeded 后 reaper
      // 又覆盖成 timed_out（或反之）——cutover 后通用 executor 的关键不变式。
      await taskRepo.create({ id: 'guard', name: 'G', enabled: true, ...baseTaskInput, timeoutSec: 60 });
      const startedAt = '2024-01-01T00:00:00.000Z';
      const run = await runRepo.createRun({
        taskId: 'guard',
        triggerSource: 'schedule',
        scheduledFor: startedAt,
        status: 'running',
        startedAt,
        idempotencyKey: 'guard:1',
      });

      // 先到者（watcher onTerminal）：succeeded。
      const first = await runRepo.finalizeRunIfRunning(run.runId, {
        status: 'succeeded',
        completedAt: '2024-01-01T00:00:30.000Z',
        runtimeResult: { stopReason: 'completed', isError: false, durationMs: 30_000 },
      });
      expect(first?.status).toBe('succeeded');

      // 后到者（reaper 误以为 stale）：timed_out 落不进 status='running' → null，
      // run 不被覆盖、completedAt 不被改。
      const second = await runRepo.finalizeRunIfRunning(run.runId, {
        status: 'timed_out',
        completedAt: '2024-01-01T00:01:00.000Z',
        error: 'reaper too late',
        runtimeResult: { stopReason: 'timeout', isError: true, durationMs: 60_000 },
      });
      expect(second).toBeNull();

      const after = await runRepo.getRun(run.runId);
      expect(after?.status).toBe('succeeded');
      expect(after?.completedAt).toBe('2024-01-01T00:00:30.000Z');
    });
  });

  describe('triggerTaskNow', () => {
    it('claims a manual run and dispatches', async () => {
      const { dispatcher, dispatched } = makeRecordingDispatcher();
      const scheduler = new ScheduledTaskScheduler(taskRepo, runRepo, dispatcher);
      await taskRepo.create({ id: 'manual', name: 'M', enabled: true, ...baseTaskInput });
      const now = new Date('2024-01-01T00:00:30.000Z');

      const run = await scheduler.triggerTaskNow('manual', now);
      expect(run.triggerSource).toBe('manual');
      expect(run.status).toBe('queued');
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0].run.runId).toBe(run.runId);
    });

    it('throws when a run is already active (single-flight)', async () => {
      const scheduler = new ScheduledTaskScheduler(
        taskRepo,
        runRepo,
        makeRecordingDispatcher().dispatcher,
      );
      await taskRepo.create({ id: 'dup', name: 'D', enabled: true, ...baseTaskInput });
      const now = new Date('2024-01-01T00:00:30.000Z');

      await scheduler.triggerTaskNow('dup', now);
      await expect(scheduler.triggerTaskNow('dup', now)).rejects.toThrow(/already has an active run/);
    });

    it('throws when the task does not exist', async () => {
      const scheduler = new ScheduledTaskScheduler(
        taskRepo,
        runRepo,
        makeRecordingDispatcher().dispatcher,
      );
      await expect(scheduler.triggerTaskNow('nope', new Date())).rejects.toThrow(/not found/);
    });
  });

  describe('discardMissedOnStartup', () => {
    it('recomputes past nextRunAt, cancels queued runs, and preserves running runs for recovery', async () => {
      const scheduler = new ScheduledTaskScheduler(
        taskRepo,
        runRepo,
        makeRecordingDispatcher().dispatcher,
      );
      await taskRepo.create({ id: 'missed', name: 'M', enabled: true, ...baseTaskInput });

      // Simulate a crashed/leftover state: nextRunAt in the past + a stale 'running' run.
      await taskRepo.updateScheduleState('missed', { nextRunAt: '2024-01-01T00:00:00.000Z' });
      await runRepo.createRun({
        taskId: 'missed',
        triggerSource: 'schedule',
        scheduledFor: '2024-01-01T00:00:00.000Z',
        status: 'running',
        idempotencyKey: 'missed:2024-01-01T00:00:00.000Z',
      });
      await runRepo.createRun({
        taskId: 'missed',
        triggerSource: 'recovery',
        scheduledFor: '2024-01-01T00:01:00.000Z',
        status: 'queued',
        idempotencyKey: 'missed:queued',
      });
      const now = new Date('2024-01-01T00:05:00.000Z');

      const changed = await scheduler.discardMissedOnStartup(now);
      expect(changed).toBe(true);

      const after = await taskRepo.getById('missed');
      expect(after?.nextRunAt).toBe('2024-01-01T00:06:00.000Z');
      expect(after?.lastRecoveredAt).toBe('2024-01-01T00:05:00.000Z');
      const active = await runRepo.getActiveRun('missed');
      expect(active?.status).toBe('running');
      const runs = await runRepo.listRuns('missed');
      expect(runs.find((run) => run.idempotencyKey === 'missed:queued')?.status).toBe('cancelled');
    });

    it('returns false when nothing is missed and no active runs exist', async () => {
      const scheduler = new ScheduledTaskScheduler(
        taskRepo,
        runRepo,
        makeRecordingDispatcher().dispatcher,
      );
      await taskRepo.create({ id: 'fresh', name: 'F', enabled: true, ...baseTaskInput });
      await scheduler.refreshSchedule(new Date('2024-01-01T00:00:30.000Z')); // nextRunAt in the future
      const changed = await scheduler.discardMissedOnStartup(new Date('2024-01-01T00:00:30.000Z'));
      expect(changed).toBe(false);
    });
  });
});
