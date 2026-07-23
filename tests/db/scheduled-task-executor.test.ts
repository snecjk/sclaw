import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupInMemoryDb, type InMemoryDb } from './helpers';
import { ScheduleTaskRepository } from '../../electron/db/repositories/schedule-task-repository';
import { ScheduleTaskRunRepository } from '../../electron/db/repositories/schedule-task-run-repository';
import { EngineScheduledTaskDispatcher } from '../../electron/services/scheduled-task-executor';
import type {
  ScheduleTask,
  ScheduleTaskRun,
} from '../../electron/db/models/domain/schedule-task';

/**
 * 执行器契约：DB 生命周期（queued→running→succeeded/failed）+ MainChatSendInput 塑形。
 * `chat-send-service.runMainChatSend` 用 vi.mock 替身——本测不验证引擎执行内部
 * （那是 adapter / runMainChatSend 的各自测试职责），只锁执行器如何编排它们与 run 行。
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

/** 让 setTimeout(0) 的 backoff 重试 dispatch 真正触发（macrotask 让位）。 */
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

  function makeDispatcher(opts: {
    gatewayManager?: object | null;
    sessionKey?: string;
    systemPromptAppend?: string | null;
  } = {}) {
    return new EngineScheduledTaskDispatcher({
      runRepo,
      taskRepo,
      getGatewayManager: () => (opts.gatewayManager === undefined ? { gm: true } : opts.gatewayManager),
      ensureDatedSession: async () => ({ sessionKey: opts.sessionKey ?? 'sched:t1:20240101' }),
      buildSystemPromptAppend: () => opts.systemPromptAppend ?? null,
      getEventSink: () => sink.sink,
    });
  }

  it('marks run failed when gatewayManager is not registered (no send attempted)', async () => {
    const { task, run } = await seedRun();
    const dispatcher = makeDispatcher({ gatewayManager: null });

    await dispatcher.dispatch({ task, run });

    expect(runMainChatSendMock).not.toHaveBeenCalled();
    const after = await runRepo.getRun(run.runId);
    expect(after?.status).toBe('failed');
    expect(after?.error).toMatch(/gateway manager not registered/);
    // 未进 dispatch 体（startedAtMs 未设），故不写 runtimeResult。
    expect(after?.runtimeResult).toBeNull();
  });

  it('ensures dated session, marks running, then succeeded on send success', async () => {
    const { task, run } = await seedRun();
    runMainChatSendMock.mockResolvedValue({ success: true, result: { runId: 'engine-run-1' } });
    const dispatcher = makeDispatcher({ systemPromptAppend: '[dingtalk recipients]' });

    await dispatcher.dispatch({ task, run });

    // send 被调一次；input 塑形正确（sessionKey 来自 ensureDatedSession、幂等键、权限档位、dingtalk 段）。
    expect(runMainChatSendMock).toHaveBeenCalledTimes(1);
    const passedInput = runMainChatSendMock.mock.calls[0][1];
    expect(passedInput).toMatchObject({
      sessionKey: 'sched:t1:20240101',
      message: 'run report',
      deliver: true,
      idempotencyKey: 'idem-1',
      permissionProfile: 'workspace-write',
      systemPromptAppend: '[dingtalk recipients]',
    });

    const after = await runRepo.getRun(run.runId);
    expect(after?.status).toBe('succeeded');
    expect(after?.sessionKey).toBe('sched:t1:20240101');
    expect(after?.startedAt).not.toBeNull();
    expect(after?.completedAt).not.toBeNull();
    expect(after?.runtimeResult).toEqual({
      stopReason: null,
      isError: false,
      durationMs: expect.any(Number),
    });
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
    const dispatcher = new EngineScheduledTaskDispatcher({
      runRepo,
      taskRepo,
      getGatewayManager: () => ({ gm: true }),
      ensureDatedSession: ensureSpy,
      buildSystemPromptAppend: () => null,
      getEventSink: () => sink.sink,
    });

    await dispatcher.dispatch({ task, run });

    expect(ensureSpy).not.toHaveBeenCalled();
    const passedInput = runMainChatSendMock.mock.calls[0][1];
    expect(passedInput.sessionKey).toBe('preexisting:session');
    expect(passedInput.systemPromptAppend).toBeUndefined();
    const after = await runRepo.getRun(run.runId);
    expect(after?.status).toBe('succeeded');
    expect(after?.sessionKey).toBe('preexisting:session');
  });

  it('marks failed when send returns non-success', async () => {
    const { task, run } = await seedRun();
    runMainChatSendMock.mockResolvedValue({ success: false, error: 'engine refused' });
    const dispatcher = makeDispatcher();

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
    const dispatcher = makeDispatcher();

    await dispatcher.dispatch({ task, run });

    const after = await runRepo.getRun(run.runId);
    expect(after?.status).toBe('failed');
    expect(after?.error).toBe('boom');
    expect(after?.runtimeResult?.isError).toBe(true);
  });

  it('schedules a recovery retry run on failure and re-dispatches it after backoff', async () => {
    // retryPolicy {maxAttempts:2, backoffSec:0}：run1 失败 → attempt1<2 → scheduleRetry
    // 建 recovery/attempt2/queued run + 发 retrying 事件；setTimeout(0) 后重试 dispatch。
    const { task, run } = await seedRun({ retryPolicy: { maxAttempts: 2, backoffSec: 0 } });
    runMainChatSendMock.mockResolvedValueOnce({ success: false, error: 'transient' });
    runMainChatSendMock.mockResolvedValueOnce({ success: true, result: { runId: 'engine-retry' } });
    const dispatcher = makeDispatcher();

    await dispatcher.dispatch({ task, run });

    expect(runMainChatSendMock).toHaveBeenCalledTimes(1); // 仅 run1 已发
    const run1After = await runRepo.getRun(run.runId);
    expect(run1After?.status).toBe('failed');
    // retrying 事件已发，run2 还未 dispatch（macrotask 未让位）
    expect(sink.events.map((e) => e.event)).toEqual(['scheduled-task:run:retrying']);

    // 推进 backoff(0ms) → 重试 dispatch 触发 → send 成功
    await nextTick();
    await nextTick();

    expect(runMainChatSendMock).toHaveBeenCalledTimes(2);
    const runs = await runRepo.listRuns(task.id);
    const retryRun = runs.find((r) => r.triggerSource === 'recovery');
    expect(retryRun?.status).toBe('succeeded');
    expect(retryRun?.attempt).toBe(2);
    // run1 失败走 retry 分支（未发 failed），仅 retrying + 重试 succeeded
    expect(sink.events.map((e) => e.event)).toEqual([
      'scheduled-task:run:retrying',
      'scheduled-task:run:succeeded',
    ]);
  });

  it('exhausts retries then applies failurePolicy: emits failed and pauses task', async () => {
    // 无 retryPolicy → 每次失败直落 applyFailurePolicy；failurePolicy 阈值 2。
    const task = await taskRepo.create({
      id: 't1',
      name: 'T1',
      enabled: true,
      ...baseTaskInput,
      failurePolicy: { pauseAfterConsecutiveFailures: 2 },
    });
    runMainChatSendMock.mockResolvedValue({ success: false, error: 'fail' });
    const dispatcher = makeDispatcher();

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
});
