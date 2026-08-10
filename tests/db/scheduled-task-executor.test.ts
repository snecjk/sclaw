import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupInMemoryDb, type InMemoryDb } from './helpers';
import { ScheduleTaskRepository } from '../../electron/db/repositories/schedule-task-repository';
import { ScheduleTaskRunRepository } from '../../electron/db/repositories/schedule-task-run-repository';
import { EngineScheduledTaskDispatcher } from '../../electron/scheduled-tasks/scheduled-task-executor';
import type { CanonicalChatEvent } from '../../shared/chat-runtime-protocol';
import type {
  ScheduleTask,
  ScheduleTaskRun,
} from '../../electron/db/models/domain/schedule-task';

/**
 * 执行器契约：DB 生命周期（queued→running→canonical 终态）
 * + MainChatSendInput 塑形 + Supervisor coordinator 闭环。
 *
 * `chat-send-service.runMainChatSend` 用 vi.mock 替身——本测不验证引擎执行内部，
 * 只锁执行器如何编排 run 行：send 成功后 run 留 `running`，canonical event
 * 驱动终态闭环。
 */
const runMainChatSendMock = vi.fn();
vi.mock('../../electron/services/chat-send-service', () => ({
  runMainChatSend: (gm: unknown, input: unknown, prepare: unknown, dispatch: unknown) =>
    runMainChatSendMock(gm, input, prepare, dispatch),
}));

const baseTaskInput = {
  engineType: 'claude' as const,
  prompt: 'run report',
  agentId: 'agent-1',
  cronExpr: '0 9 * * *',
  permissionProfile: 'workspace-write' as const,
};

/** 让 setTimeout(0) 的 defer / backoff 真正触发（macrotask 让位）。 */
const nextTick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('EngineScheduledTaskDispatcher', () => {
  let env: InMemoryDb;
  let taskRepo: ScheduleTaskRepository;
  let runRepo: ScheduleTaskRunRepository;
  let sink: ReturnType<typeof buildCapturingSink>;

  beforeEach(() => {
    env = setupInMemoryDb();
    taskRepo = new ScheduleTaskRepository();
    runRepo = new ScheduleTaskRunRepository();
    runMainChatSendMock.mockReset();
    sink = buildCapturingSink();
  });

  afterEach(() => env.teardown());

  /** 捕获事件下沉——记录 {event, payload} 供断言 run 生命周期事件。 */
  function buildCapturingSink() {
    const events: { event: string; payload: unknown }[] = [];
    return {
      events,
      sink: {
        emit(event: string, payload: unknown) {
          events.push({ event, payload });
        },
      },
    };
  }

  /** 造任务 + 占位 run（queued，无 sessionKey），返回 { task, run }。 */
  async function seedRun(
    overrides: Partial<ScheduleTask> & { attemptIdem?: string } = {},
  ): Promise<{ task: ScheduleTask; run: ScheduleTaskRun }> {
    const { attemptIdem, ...taskOverrides } = overrides;
    const task = await taskRepo.create({ id: 't1', name: 'T1', enabled: true, ...baseTaskInput, ...taskOverrides });
    const run = await runRepo.createRun({
      taskId: task.id,
      triggerSource: 'schedule',
      idempotencyKey: attemptIdem ?? 'idem-1',
      scheduledFor: '2024-01-01T09:00:00.000Z',
    });
    return { task, run };
  }

  /**
   * 真 EventEmitter 作为 gateway（watcher 订阅 + 测试 emit 驱动终态）。默认
   * ensureDatedSession 返回固定 sessionKey；可注入 ensureDatedSession 验证复用路径。
   */
  function makeDispatcher(opts: {
    gatewayManager?: object | null;
    sessionKey?: string;
    systemPromptAppend?: string | null;
    ensureDatedSession?: (task: ScheduleTask, date: Date) => Promise<{ sessionKey: string }>;
  } = {}) {
    const gateway: EventEmitter | null =
      opts.gatewayManager === null
        ? null
        : opts.gatewayManager instanceof EventEmitter
          ? opts.gatewayManager
          : new EventEmitter();
    const dispatcher = new EngineScheduledTaskDispatcher({
      runRepo,
      taskRepo,
      getGatewayManager: () => gateway,
      ensureDatedSession:
        opts.ensureDatedSession ?? (async () => ({ sessionKey: opts.sessionKey ?? 'sched:t1:20240101' })),
      buildSystemPromptAppend: () => opts.systemPromptAppend ?? null,
      getEventSink: () => sink.sink,
    });
    return { dispatcher, gateway };
  }

  function canonicalTerminal(
    task: ScheduleTask,
    run: ScheduleTaskRun,
    type: 'run.completed' | 'run.failed' | 'run.aborted' | 'run.interrupted',
    payload?: Record<string, unknown>,
  ): CanonicalChatEvent {
    return {
      protocolVersion: 1,
      eventId: `${run.runId}:${type}:${Date.now()}`,
      sessionKey: run.sessionKey ?? 'sched:t1:20240101',
      runId: 'engine-run-1',
      idempotencyKey: run.idempotencyKey,
      runtimePolicy: { origin: 'scheduled_task', ownerId: run.runId, deadlineAt: null },
      engineType: task.engineType,
      epoch: 1,
      sequence: 3,
      occurredAt: Date.now(),
      type,
      payload: payload ?? { reason: type.slice('run.'.length) },
    };
  }

  it('recognizes scheduled-task session provenance regardless of run status', async () => {
    const { run } = await seedRun();
    expect(await runRepo.existsBySessionKey('session-scheduled')).toBe(false);

    await runRepo.updateRun(run.runId, {
      status: 'succeeded',
      sessionKey: 'session-scheduled',
    });

    expect(await runRepo.existsBySessionKey('session-scheduled')).toBe(true);
  });

  it('marks run failed when gatewayManager is not registered (no send attempted)', async () => {
    const { task, run } = await seedRun();
    const { dispatcher } = makeDispatcher({ gatewayManager: null });

    await dispatcher.dispatch({ task, run });

    expect(runMainChatSendMock).not.toHaveBeenCalled();
    const after = await runRepo.getRun(run.runId);
    expect(after?.status).toBe('failed');
    expect(after?.error).toMatch(/gateway manager not registered/);
    // 未进 dispatch 体（startedAtMs 未设），故不写 runtimeResult。
    expect(after?.runtimeResult).toBeNull();
  });

  it('send success leaves run running; canonical terminal → succeeded + runtimeResult', async () => {
    const { task, run } = await seedRun();
    runMainChatSendMock.mockResolvedValue({ success: true, result: { runId: 'engine-run-1' } });
    const { dispatcher } = makeDispatcher({ systemPromptAppend: '[dingtalk recipients]' });

    await dispatcher.dispatch({ task, run });

    // send 被调一次；Claude + append → message prepend 收件人规则，systemPromptAppend 仍保留。
    expect(runMainChatSendMock).toHaveBeenCalledTimes(1);
    const passedInput = runMainChatSendMock.mock.calls[0][1];
    expect(passedInput).toMatchObject({
      sessionKey: 'sched:t1:20240101',
      deliver: true,
      idempotencyKey: 'idem-1',
      permissionProfile: 'workspace-write',
      systemPromptAppend: '[dingtalk recipients]',
      displayText: 'run report',
    });
    expect(passedInput.message).toBe('[dingtalk recipients]\n\nrun report');

    // send resolve 只表 run 启动——run 仍 running，不在此置 succeeded。
    const mid = await runRepo.getRun(run.runId);
    expect(mid?.status).toBe('running');
    expect(mid?.sessionKey).toBe('sched:t1:20240101');
    expect(mid?.startedAt).not.toBeNull();

    await dispatcher.handleCanonicalEvent(canonicalTerminal(task, { ...run, sessionKey: mid!.sessionKey }, 'run.completed'));

    const after = await runRepo.getRun(run.runId);
    expect(after?.completedAt).not.toBeNull();
    expect(after?.runtimeResult).toEqual({
      stopReason: 'completed',
      isError: false,
      durationMs: expect.any(Number),
    });
    expect(sink.events.map((e) => e.event)).toContain('scheduled-task:run:succeeded');
  });

  it('passes task.prompt as message unchanged when dingtalkRecipients present', async () => {
    const { task, run } = await seedRun({
      prompt: '汇总后发给张三',
      dingtalkRecipients: [
        { type: 'user', displayName: '张三', userId: 'u-1' },
        { type: 'group', displayName: '开发', openConversationId: 'cid-1' },
      ],
    });
    runMainChatSendMock.mockResolvedValue({ success: true, result: { runId: 'engine-run-trailer' } });
    const { dispatcher } = makeDispatcher();

    await dispatcher.dispatch({ task, run });

    const passedInput = runMainChatSendMock.mock.calls[0][1] as { message: string };
    // 不再把列收件人并入 message；message 即库内 prompt
    expect(passedInput.message).toBe('汇总后发给张三');
    expect((await taskRepo.getById(task.id))?.prompt).toBe('汇总后发给张三');

    await dispatcher.handleCanonicalEvent(canonicalTerminal(task, { ...run, sessionKey: 'sched:t1:20240101' }, 'run.completed'));
    expect((await runRepo.getRun(run.runId))?.status).toBe('succeeded');
  });

  it('openclaw keeps prompt as message; append stays for adapter merge (no double prepend)', async () => {
    const { task, run } = await seedRun({ engineType: 'openclaw' });
    runMainChatSendMock.mockResolvedValue({ success: true, result: { runId: 'engine-run-oc' } });
    const { dispatcher } = makeDispatcher({ systemPromptAppend: '[dingtalk recipients]' });

    await dispatcher.dispatch({ task, run });

    const passedInput = runMainChatSendMock.mock.calls[0][1];
    expect(passedInput.message).toBe('run report');
    expect(passedInput.systemPromptAppend).toBe('[dingtalk recipients]');

    await dispatcher.handleCanonicalEvent(canonicalTerminal(task, { ...run, sessionKey: 'sched:t1:20240101' }, 'run.completed'));
    expect((await runRepo.getRun(run.runId))?.status).toBe('succeeded');
  });

  it('reuses existing run.sessionKey and omits systemPromptAppend when null', async () => {
    // run 已带 sessionKey（恢复路径，例如重启后接续未完成 run）——ensureDatedSession 不该被调。
    const task = await taskRepo.create({ id: 't2', name: 'T2', enabled: true, ...baseTaskInput });
    const run = await runRepo.createRun({
      taskId: task.id,
      triggerSource: 'recovery',
      idempotencyKey: 'idem-2',
      sessionKey: 'preexisting:session',
    });
    runMainChatSendMock.mockResolvedValue({ success: true, result: { runId: 'engine-run-2' } });
    const ensureSpy = vi.fn(async () => ({ sessionKey: 'should-not-be-used' }));
    const { dispatcher } = makeDispatcher({ ensureDatedSession: ensureSpy });

    await dispatcher.dispatch({ task, run });

    expect(ensureSpy).not.toHaveBeenCalled();
    const passedInput = runMainChatSendMock.mock.calls[0][1];
    expect(passedInput.sessionKey).toBe('preexisting:session');
    expect(passedInput.systemPromptAppend).toBeUndefined();
    expect(passedInput.message).toBe('run report');
    expect((await runRepo.getRun(run.runId))?.status).toBe('running');

    await dispatcher.handleCanonicalEvent(canonicalTerminal(task, run, 'run.completed'));
    const after = await runRepo.getRun(run.runId);
    expect(after?.sessionKey).toBe('preexisting:session');
  });

  it('marks failed when send returns non-success', async () => {
    const { task, run } = await seedRun();
    runMainChatSendMock.mockResolvedValue({ success: false, error: 'engine refused' });
    const { dispatcher } = makeDispatcher();

    await dispatcher.dispatch({ task, run });

    const after = await runRepo.getRun(run.runId);
    expect(after?.status).toBe('failed');
    expect(after?.error).toBe('engine refused');
    expect(after?.runtimeResult?.isError).toBe(true);
    expect(after?.runtimeResult?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('marks failed when send throws', async () => {
    const { task, run } = await seedRun();
    runMainChatSendMock.mockRejectedValue(new Error('boom'));
    const { dispatcher } = makeDispatcher();

    await dispatcher.dispatch({ task, run });

    const after = await runRepo.getRun(run.runId);
    expect(after?.status).toBe('failed');
    expect(after?.error).toBe('boom');
    expect(after?.runtimeResult?.isError).toBe(true);
  });

  it('schedules a recovery retry run on failure and re-dispatches it after backoff', async () => {
    // retryPolicy {maxAttempts:2, backoffSec:0}：run1 send 失败 → attempt1<2 → scheduleRetry
    // 建 recovery/attempt2/queued run + 发 retrying 事件；setTimeout(0) 后重试 dispatch。
    // run2 send 成功 → run running → watcher 终态闭环 succeeded。
    const { task, run } = await seedRun({ retryPolicy: { maxAttempts: 2, backoffSec: 0 } });
    runMainChatSendMock.mockResolvedValueOnce({ success: false, error: 'transient' });
    runMainChatSendMock.mockResolvedValueOnce({ success: true, result: { runId: 'engine-retry' } });
    const { dispatcher } = makeDispatcher();

    await dispatcher.dispatch({ task, run });

    expect(runMainChatSendMock).toHaveBeenCalledTimes(1); // 仅 run1 已发
    const run1After = await runRepo.getRun(run.runId);
    expect(run1After?.status).toBe('failed');
    // retrying 事件已发，run2 还未 dispatch（macrotask 未让位）
    expect(sink.events.map((e) => e.event)).toEqual(['scheduled-task:run:retrying']);

    // 推进 backoff(0ms) → 重试 dispatch 触发 → send 成功 → run2 running + watcher 挂上
    await nextTick();
    await nextTick();

    expect(runMainChatSendMock).toHaveBeenCalledTimes(2);
    const retryRun = (await runRepo.listRuns(task.id)).find((r) => r.triggerSource === 'recovery');
    expect(retryRun?.attempt).toBe(2);
    expect(retryRun?.status).toBe('running');

    await dispatcher.handleCanonicalEvent(canonicalTerminal(task, retryRun!, 'run.completed'));
    expect((await runRepo.getRun(retryRun!.runId))?.status).toBe('succeeded');
    expect(sink.events.map((e) => e.event)).toContain('scheduled-task:run:succeeded');
  });

  it('exhausts retries then applies failurePolicy: emits failed and pauses task', async () => {
    // 无 retryPolicy → 每次失败直落 applyFailurePolicy；failurePolicy 阈值 2。两 run 均
    // send non-success（不挂 watcher、不走 finalizeRunIfRunning）。
    const task = await taskRepo.create({
      id: 't1',
      name: 'T1',
      enabled: true,
      ...baseTaskInput,
      failurePolicy: { pauseAfterConsecutiveFailures: 2 },
    });
    runMainChatSendMock.mockResolvedValue({ success: false, error: 'fail' });
    const { dispatcher } = makeDispatcher();

    const run1 = await runRepo.createRun({
      taskId: task.id,
      triggerSource: 'schedule',
      idempotencyKey: 'f1',
      scheduledFor: '2024-01-01T09:00:00.000Z',
    });
    await dispatcher.dispatch({ task, run: run1 });
    // 1 连续失败 < 2 → 不暂停，仅发 failed
    expect((await taskRepo.getById(task.id))?.enabled).toBe(true);
    expect(sink.events.filter((e) => e.event === 'scheduled-task:run:failed')).toHaveLength(1);

    const run2 = await runRepo.createRun({
      taskId: task.id,
      triggerSource: 'schedule',
      idempotencyKey: 'f2',
      scheduledFor: '2024-01-01T09:01:00.000Z',
    });
    await dispatcher.dispatch({ task, run: run2 });
    // 2 连续失败 >= 2 → 暂停 + paused 事件
    expect((await taskRepo.getById(task.id))?.enabled).toBe(false);
    expect(sink.events.filter((e) => e.event === 'scheduled-task:run:failed')).toHaveLength(2);
    expect(
      sink.events.find((e) => e.event === 'scheduled-task:task:paused'),
    ).toMatchObject({
      event: 'scheduled-task:task:paused',
      payload: { taskId: task.id, consecutiveFailures: 2, threshold: 2 },
    });
  });

  it('canonical terminal error → failed + handleFailure (retry)', async () => {
    // send 成功 → run running；chat state=error → watcher onTerminal(isError) →
    // finalizeRunIfRunning(failed) + handleFailure → retry（attempt1<2）→ retrying。
    const { task, run } = await seedRun({ retryPolicy: { maxAttempts: 2, backoffSec: 3600 } });
    runMainChatSendMock.mockResolvedValue({ success: true, result: { runId: 'engine-run-1' } });
    const { dispatcher } = makeDispatcher();

    await dispatcher.dispatch({ task, run });
    expect((await runRepo.getRun(run.runId))?.status).toBe('running');

    await dispatcher.handleCanonicalEvent(canonicalTerminal(task, { ...run, sessionKey: 'sched:t1:20240101' }, 'run.failed', {
      reason: 'error',
      error: 'agent crashed',
    }));

    const after = await runRepo.getRun(run.runId);
    expect(after?.runtimeResult?.stopReason).toBe('error');
    expect(after?.runtimeResult?.isError).toBe(true);
    expect(after?.error).toBe('agent crashed');
    expect(sink.events.map((e) => e.event)).toContain('scheduled-task:run:retrying');
    const retryRun = (await runRepo.listRuns(task.id)).find((r) => r.triggerSource === 'recovery');
    expect(retryRun).toBeTruthy();
  });

  it('canonical hard deadline interruption → timed_out + retry', async () => {
    // Supervisor 负责 deadline 与引擎 abort；dispatcher 只消费统一 interrupted 终态。
    vi.useFakeTimers();
    try {
      const { task, run } = await seedRun({
        retryPolicy: { maxAttempts: 2, backoffSec: 3600 },
        timeoutSec: 60,
      });
      runMainChatSendMock.mockResolvedValue({ success: true, result: { runId: 'engine-run-1' } });
      const { dispatcher } = makeDispatcher();

      await dispatcher.dispatch({ task, run });
      expect((await runRepo.getRun(run.runId))?.status).toBe('running');

      await dispatcher.handleCanonicalEvent(canonicalTerminal(task, { ...run, sessionKey: 'sched:t1:20240101' }, 'run.interrupted', {
        reason: 'hard-deadline',
      }));

      const after = await runRepo.getRun(run.runId);
      expect(after?.status).toBe('timed_out');
      expect(after?.runtimeResult?.stopReason).toBe('hard-deadline');
      expect(after?.runtimeResult?.isError).toBe(true);
      // handleFailure → scheduleRetry（attempt1<2）→ retrying 事件 + queued retry run。
      expect(sink.events.map((e) => e.event)).toContain('scheduled-task:run:retrying');
      const retryRun = (await runRepo.listRuns(task.id)).find((r) => r.triggerSource === 'recovery');
      expect(retryRun?.status).toBe('queued');
      // 重试 backoff(3600s) 未到 → 不该再次 dispatch。
      expect(runMainChatSendMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('canonical user abort → cancelled without retry', async () => {
    const { task, run } = await seedRun({
      retryPolicy: { maxAttempts: 2, backoffSec: 3600 },
    });
    runMainChatSendMock.mockResolvedValue({ success: true, result: { runId: 'engine-run-1' } });
    const { dispatcher } = makeDispatcher();

    await dispatcher.dispatch({ task, run });
    expect((await runRepo.getRun(run.runId))?.status).toBe('running');

    await dispatcher.handleCanonicalEvent(canonicalTerminal(
      task,
      { ...run, sessionKey: 'sched:t1:20240101' },
      'run.aborted',
      { reason: 'user-abort' },
    ));

    const after = await runRepo.getRun(run.runId);
    expect(after?.status).toBe('cancelled');
    expect(after?.runtimeResult).toMatchObject({ stopReason: 'user-abort', isError: false });
    expect((await runRepo.listRuns(task.id)).filter((item) => item.triggerSource === 'recovery')).toHaveLength(0);
  });

  it('finalizes run succeeded on terminal without dws fallback', async () => {
    const { task, run } = await seedRun({
      dingtalkRecipients: [{ type: 'user', userId: 'u1', displayName: 'U1' }],
    });
    runMainChatSendMock.mockResolvedValue({ success: true, result: { runId: 'engine-run-1' } });
    const { dispatcher } = makeDispatcher();

    await dispatcher.dispatch({ task, run });
    await dispatcher.handleCanonicalEvent(canonicalTerminal(task, { ...run, sessionKey: 'sched:t1:20240101' }, 'run.completed'));
    expect((await runRepo.getRun(run.runId))?.status).toBe('succeeded');
  });

  it('double finalize guard: terminal after timeout does not overwrite', async () => {
    const { task, run } = await seedRun({ timeoutSec: 60 });
    runMainChatSendMock.mockResolvedValue({ success: true, result: { runId: 'engine-run-1' } });
    const { dispatcher } = makeDispatcher();

    await dispatcher.dispatch({ task, run });
    const running = { ...run, sessionKey: 'sched:t1:20240101' };
    await dispatcher.handleCanonicalEvent(canonicalTerminal(task, running, 'run.interrupted', { reason: 'hard-deadline' }));
    expect((await runRepo.getRun(run.runId))?.status).toBe('timed_out');

    await dispatcher.handleCanonicalEvent(canonicalTerminal(task, running, 'run.completed'));
    expect((await runRepo.getRun(run.runId))?.status).toBe('timed_out');
  });
});
