import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupInMemoryDb, type InMemoryDb } from './helpers';
import { ScheduleTaskRepository } from '../../electron/db/repositories/schedule-task-repository';
import { ScheduleTaskRunRepository } from '../../electron/db/repositories/schedule-task-run-repository';
import { EngineScheduledTaskDispatcher } from '../../electron/scheduled-tasks/scheduled-task-executor';
import { getAdapter } from '../../electron/engines/manager';
import type {
  ScheduleTask,
  ScheduleTaskRun,
} from '../../electron/db/models/domain/schedule-task';

/**
 * 执行器契约：DB 生命周期（queued→running→[watcher 终态]succeeded/failed/timed_out）
 * + MainChatSendInput 塑形 + run watcher 闭环。
 *
 * `chat-send-service.runMainChatSend` 与 `scheduled-task-dingtalk-fallback` 均用
 * vi.mock 替身——本测不验证引擎执行内部（adapter / runMainChatSend 各自测试职责），
 * 也不真发钉钉（fallback 单测覆盖），只锁执行器如何编排它们与 run 行：send 成功后
 * run 留 `running`、挂 watcher；gateway 事件驱动终态闭环。
 */
const runMainChatSendMock = vi.fn();
vi.mock('../../electron/services/chat-send-service', () => ({
  runMainChatSend: (gm: unknown, input: unknown, prepare: unknown, dispatch: unknown) =>
    runMainChatSendMock(gm, input, prepare, dispatch),
}));

const fallbackMock = vi.fn();
vi.mock('../../electron/scheduled-tasks/scheduled-task-dingtalk-fallback', () => ({
  sendScheduledTaskResultFallback: (payload: unknown) => fallbackMock(payload),
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

/** 驱动 claude assistant final 片段（watcher 累积 lastAssistantText）。 */
function emitAssistantFinal(gateway: EventEmitter, sessionKey: string, text: string): void {
  gateway.emit('chat:message', {
    message: {
      sessionKey,
      state: 'final',
      message: { role: 'assistant', content: [{ type: 'text', text }] },
    },
  });
}

/** 驱动 claude agent notification 终态（phase=completed|error）。 */
function emitAgentTerminal(
  gateway: EventEmitter,
  sessionKey: string,
  phase: 'completed' | 'error' = 'completed',
): void {
  gateway.emit('notification', { method: 'agent', params: { sessionKey, phase } });
}

/** 驱动 chat:message 终态（state=done|error|aborted）。 */
function emitChatTerminal(
  gateway: EventEmitter,
  sessionKey: string,
  state: 'done' | 'error' | 'aborted',
  errorMessage?: string,
): void {
  gateway.emit('chat:message', {
    message: { sessionKey, state, ...(errorMessage ? { errorMessage } : {}) },
  });
}

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
    fallbackMock.mockReset();
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

  it('send success leaves run running; watcher terminal → succeeded + runtimeResult', async () => {
    const { task, run } = await seedRun();
    runMainChatSendMock.mockResolvedValue({ success: true, result: { runId: 'engine-run-1' } });
    const { dispatcher, gateway } = makeDispatcher({ systemPromptAppend: '[dingtalk recipients]' });

    await dispatcher.dispatch({ task, run });

    // send 被调一次；input 塑形正确（sessionKey、幂等键、权限档位、dingtalk 段）。
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

    // §0：send resolve 只表 run 启动——run 仍 running，不在此置 succeeded。
    const mid = await runRepo.getRun(run.runId);
    expect(mid?.status).toBe('running');
    expect(mid?.sessionKey).toBe('sched:t1:20240101');
    expect(mid?.startedAt).not.toBeNull();

    // watcher 终态闭环：claude agent notification phase=completed → succeeded。
    emitAgentTerminal(gateway!, 'sched:t1:20240101', 'completed');
    await vi.waitFor(
      async () => {
        expect((await runRepo.getRun(run.runId))?.status).toBe('succeeded');
      },
      { timeout: 2000, interval: 10 },
    );

    const after = await runRepo.getRun(run.runId);
    expect(after?.completedAt).not.toBeNull();
    expect(after?.runtimeResult).toEqual({
      stopReason: 'completed',
      isError: false,
      durationMs: expect.any(Number),
    });
    expect(sink.events.map((e) => e.event)).toContain('scheduled-task:run:succeeded');
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
    const { dispatcher, gateway } = makeDispatcher({ ensureDatedSession: ensureSpy });

    await dispatcher.dispatch({ task, run });

    expect(ensureSpy).not.toHaveBeenCalled();
    const passedInput = runMainChatSendMock.mock.calls[0][1];
    expect(passedInput.sessionKey).toBe('preexisting:session');
    expect(passedInput.systemPromptAppend).toBeUndefined();
    expect((await runRepo.getRun(run.runId))?.status).toBe('running');

    // watcher 终态（复用 sessionKey）：emit 用 preexisting:session。
    emitAgentTerminal(gateway!, 'preexisting:session', 'completed');
    await vi.waitFor(
      async () => {
        expect((await runRepo.getRun(run.runId))?.status).toBe('succeeded');
      },
      { timeout: 2000, interval: 10 },
    );
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
    const { dispatcher, gateway } = makeDispatcher();

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

    // watcher 终态闭环 run2 → succeeded
    emitAgentTerminal(gateway!, 'sched:t1:20240101', 'completed');
    await vi.waitFor(
      async () => {
        const rr = (await runRepo.listRuns(task.id)).find((r) => r.triggerSource === 'recovery');
        expect(rr?.status).toBe('succeeded');
      },
      { timeout: 2000, interval: 10 },
    );
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

  it('watcher terminal error → failed + handleFailure (retry)', async () => {
    // send 成功 → run running；chat state=error → watcher onTerminal(isError) →
    // finalizeRunIfRunning(failed) + handleFailure → retry（attempt1<2）→ retrying。
    const { task, run } = await seedRun({ retryPolicy: { maxAttempts: 2, backoffSec: 3600 } });
    runMainChatSendMock.mockResolvedValue({ success: true, result: { runId: 'engine-run-1' } });
    const { dispatcher, gateway } = makeDispatcher();

    await dispatcher.dispatch({ task, run });
    expect((await runRepo.getRun(run.runId))?.status).toBe('running');

    emitChatTerminal(gateway!, 'sched:t1:20240101', 'error', 'agent crashed');
    await vi.waitFor(
      async () => {
        expect((await runRepo.getRun(run.runId))?.status).toBe('failed');
      },
      { timeout: 2000, interval: 10 },
    );

    const after = await runRepo.getRun(run.runId);
    expect(after?.runtimeResult?.stopReason).toBe('error');
    expect(after?.runtimeResult?.isError).toBe(true);
    expect(after?.error).toMatch(/agent terminal: error/);
    expect(sink.events.map((e) => e.event)).toContain('scheduled-task:run:retrying');
    const retryRun = (await runRepo.listRuns(task.id)).find((r) => r.triggerSource === 'recovery');
    expect(retryRun).toBeTruthy();
  });

  it('watcher timeout → timed_out + abortRun + retry', async () => {
    // send 成功 → run running + watcher(timeoutMs)；不 emit 任何终态 → timeoutMs 到点
    // → onTimeout → abortRun(停 agent) + finalizeRunIfRunning(timed_out) + handleFailure
    // → retry。用 fake timers 精确推进 60s（真跑要等 60s）；backoffSec:3600 防重试
    // dispatch 在推进窗口内提前 fire（retryRun 应留 queued）。
    vi.useFakeTimers();
    let abortSpy: ReturnType<typeof vi.spyOn> | undefined;
    try {
      const { task, run } = await seedRun({
        retryPolicy: { maxAttempts: 2, backoffSec: 3600 },
        timeoutSec: 60,
      });
      runMainChatSendMock.mockResolvedValue({ success: true, result: { runId: 'engine-run-1' } });
      abortSpy = vi.spyOn(getAdapter('claude'), 'abortRun');
      const { dispatcher } = makeDispatcher();

      await dispatcher.dispatch({ task, run });
      expect((await runRepo.getRun(run.runId))?.status).toBe('running');

      // 推进 60s+ → watcher onTimeout fire → handleTimeout 闭环。
      await vi.advanceTimersByTimeAsync(60_001);

      const after = await runRepo.getRun(run.runId);
      expect(after?.status).toBe('timed_out');
      expect(after?.runtimeResult?.stopReason).toBe('timeout');
      expect(after?.runtimeResult?.isError).toBe(true);
      // abortRun 被调一次（停流式），传 run 的 sessionKey。
      expect(abortSpy).toHaveBeenCalledTimes(1);
      expect(abortSpy!.mock.calls[0][1]).toMatchObject({ sessionKey: 'sched:t1:20240101' });
      // handleFailure → scheduleRetry（attempt1<2）→ retrying 事件 + queued retry run。
      expect(sink.events.map((e) => e.event)).toContain('scheduled-task:run:retrying');
      const retryRun = (await runRepo.listRuns(task.id)).find((r) => r.triggerSource === 'recovery');
      expect(retryRun?.status).toBe('queued');
      // 重试 backoff(3600s) 未到 → 不该再次 dispatch。
      expect(runMainChatSendMock).toHaveBeenCalledTimes(1);
    } finally {
      abortSpy?.mockRestore();
      vi.useRealTimers();
    }
  });

  it('wires dws-send fallback on terminal success with accumulated lastAssistantText', async () => {
    // 终态成功末尾 fire-and-forget 兜底 dws-send（agent 未 self-send 时补发）。
    // 沿路累积 assistant final 正文 → 传给 fallback。fallback 整模块已 mock。
    const { task, run } = await seedRun({
      dingtalkRecipients: [{ type: 'user', userId: 'u1', displayName: 'U1' }],
    });
    runMainChatSendMock.mockResolvedValue({ success: true, result: { runId: 'engine-run-1' } });
    const { dispatcher, gateway } = makeDispatcher();

    await dispatcher.dispatch({ task, run });
    // 累积 assistant 正文（final 片段）。
    emitAssistantFinal(gateway!, 'sched:t1:20240101', '报告完成');
    // 终态触发 finalize + 兜底 dws-send。
    emitAgentTerminal(gateway!, 'sched:t1:20240101', 'completed');

    await vi.waitFor(
      () => {
        expect(fallbackMock).toHaveBeenCalledWith(
          expect.objectContaining({ lastAssistantText: '报告完成' }),
        );
      },
      { timeout: 2000, interval: 10 },
    );
    // fallback 收到 task + 累积正文（sessionKey 不入参——fallback 自取 latest assistant）。
    expect(fallbackMock).toHaveBeenCalledTimes(1);
    const payload = fallbackMock.mock.calls[0][0] as { task: ScheduleTask; lastAssistantText: string };
    expect(payload.task.id).toBe(task.id);
    // run 亦闭环 succeeded。
    expect((await runRepo.getRun(run.runId))?.status).toBe('succeeded');
  });

  it('double finalize guard: terminal after timeout does not overwrite', async () => {
    // timeoutSec:60 + fake timers：onTimeout 先赢（timed_out）→ watcher cleanup 退订。
    // 随后迟到 terminal 因已退订根本不触 onTerminal；即便触，finalizeRunIfRunning
    // 的 WHERE status='running' 也得 null（run 已 timed_out）→ 不覆盖、不双 handle。
    vi.useFakeTimers();
    let abortSpy: ReturnType<typeof vi.spyOn> | undefined;
    try {
      const { task, run } = await seedRun({ timeoutSec: 60 });
      runMainChatSendMock.mockResolvedValue({ success: true, result: { runId: 'engine-run-1' } });
      abortSpy = vi.spyOn(getAdapter('claude'), 'abortRun');
      const { dispatcher, gateway } = makeDispatcher();

      await dispatcher.dispatch({ task, run });
      await vi.advanceTimersByTimeAsync(60_001); // → onTimeout → timed_out
      const afterTimeout = await runRepo.getRun(run.runId);
      expect(afterTimeout?.status).toBe('timed_out');

      // 迟到 terminal（watcher 已 cleanup 退订，此 emit 无监听者）。
      emitAgentTerminal(gateway!, 'sched:t1:20240101', 'completed');
      await vi.advanceTimersByTimeAsync(10);

      const after = await runRepo.getRun(run.runId);
      expect(after?.status).toBe('timed_out'); // 未被 terminal 覆盖成 succeeded
      expect(fallbackMock).not.toHaveBeenCalled(); // terminal 未走成功路径 → 不发 dws
    } finally {
      abortSpy?.mockRestore();
      vi.useRealTimers();
    }
  });
});
