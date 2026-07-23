// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupInMemoryDb, type InMemoryDb } from './helpers';
import { ScheduleTaskRepository } from '../../electron/db/repositories/schedule-task-repository';
import type { GatewayManager } from '../../electron/gateway/manager';
import type { ScheduledTaskService } from '../../electron/services/scheduled-task-service';

// paths 桩：把 definitions.json / marker 引到临时目录，不触真实 home。
let claudeDir: string;
let homeDir: string;
vi.mock('../../electron/utils/paths', () => ({
  getClaudeScheduledTasksDir: () => claudeDir,
  getStoClawHomeDir: () => homeDir,
}));

// logger 桩：避免 node 环境日志依赖。
vi.mock('../../electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

/**
 * Step 4 数据迁移验收：claude definitions.json + openclaw cron.list → schedule_tasks；
 * id 保留、cron.remove 各调一次、marker 幂等、二次运行整体跳过。
 */
describe('runScheduledTasksMigration (data)', () => {
  let env: InMemoryDb;
  let taskRepo: ScheduleTaskRepository;
  let markerPath: string;

  const claudeDefinitions = [
    {
      id: 'claude-1',
      name: 'claude daily',
      enabled: true,
      cronExpr: '0 9 * * *',
      promptTemplate: 'claude prompt',
      agentId: 'agent-claude',
      workspacePath: '/tmp/ws',
      providerAccountId: 'acct-1',
      model: 'claude-5',
      permissionProfile: 'workspace-write',
      timeoutSec: 120,
      workflowCode: 'wf-claude',
      retryPolicy: { maxAttempts: 2, backoffSec: 10 },
      failurePolicy: { pauseAfterConsecutiveFailures: 3 },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  const openclawJobs = [
    {
      id: 'openclaw-1',
      name: 'openclaw hourly',
      enabled: true,
      description: JSON.stringify({ agentId: 'agent-openclaw', workflowCode: 'wf-oc' }),
      schedule: { kind: 'cron', expr: '0 * * * *' },
      payload: { message: 'openclaw prompt', model: 'gpt-4o' },
    },
    {
      id: 'openclaw-disabled',
      name: 'openclaw off',
      enabled: false,
      description: JSON.stringify({ agentId: 'main' }),
      schedule: { kind: 'cron', expr: '*/10 * * * *' },
      payload: { text: 'fallback text prompt' },
    },
  ];

  beforeEach(async () => {
    env = setupInMemoryDb();
    taskRepo = new ScheduleTaskRepository();
    claudeDir = mkdtempSync(join(tmpdir(), 'mig-claude-'));
    homeDir = mkdtempSync(join(tmpdir(), 'mig-home-'));
    markerPath = join(homeDir, 'scheduled-tasks-migration.done');
    // 写 definitions.json fixture
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(claudeDir, 'definitions.json'),
      JSON.stringify({ definitions: claudeDefinitions }),
      'utf8',
    );
  });

  afterEach(() => {
    env.teardown();
    rmSync(claudeDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  });

  function makeGm() {
    const rpc = vi.fn(async (method: string) => {
      if (method === 'cron.list') return { jobs: openclawJobs };
      if (method === 'cron.remove') return undefined;
      throw new Error(`unexpected rpc ${method}`);
    });
    return { gm: { rpc } as unknown as GatewayManager, rpc };
  }

  function makeServiceStub() {
    const refreshSchedule = vi.fn(async () => undefined);
    return { service: { refreshSchedule } as unknown as ScheduledTaskService, refreshSchedule };
  }

  it('migrates both engines, preserves ids, removes openclaw crons, writes marker', async () => {
    const { gm, rpc } = makeGm();
    const { service, refreshSchedule } = makeServiceStub();
    const { runScheduledTasksMigration } = await import('../../electron/scripts/migrate-scheduled-tasks');

    await runScheduledTasksMigration(gm, service);

    const tasks = await taskRepo.list({});
    expect(tasks).toHaveLength(3);

    const ids = tasks.map((t) => t.id).sort();
    expect(ids).toEqual(['claude-1', 'openclaw-1', 'openclaw-disabled'].sort());

    // claude 字段落对
    const claude = tasks.find((t) => t.id === 'claude-1')!;
    expect(claude.engineType).toBe('claude');
    expect(claude.prompt).toBe('claude prompt');
    expect(claude.accountId).toBe('acct-1');
    expect(claude.permissionProfile).toBe('workspace-write');
    expect(claude.retryPolicy).toEqual({ maxAttempts: 2, backoffSec: 10 });

    // openclaw 字段落对（prompt 原样保留烘焙块、recipients 空）
    const oc = tasks.find((t) => t.id === 'openclaw-1')!;
    expect(oc.engineType).toBe('openclaw');
    expect(oc.prompt).toBe('openclaw prompt');
    expect(oc.model).toBe('gpt-4o');
    expect(oc.agentId).toBe('agent-openclaw');
    expect(oc.workflowCode).toBe('wf-oc');
    expect(oc.dingtalkRecipients).toBeNull();

    // fallback text prompt
    const oc2 = tasks.find((t) => t.id === 'openclaw-disabled')!;
    expect(oc2.prompt).toBe('fallback text prompt');
    expect(oc2.enabled).toBe(false);

    // 每条 openclaw cron 都 remove 一次
    expect(rpc).toHaveBeenCalledWith('cron.list', { includeDisabled: true });
    const removes = rpc.mock.calls.filter((c) => c[0] === 'cron.remove');
    expect(removes).toHaveLength(2);

    expect(existsSync(markerPath)).toBe(true);
    expect(refreshSchedule).toHaveBeenCalledTimes(1);
  });

  it('skips entirely when marker present (idempotent second run)', async () => {
    const { gm, rpc } = makeGm();
    const { service, refreshSchedule } = makeServiceStub();
    const { runScheduledTasksMigration } = await import('../../electron/scripts/migrate-scheduled-tasks');

    await runScheduledTasksMigration(gm, service);
    const afterFirst = (await taskRepo.list({})).length;
    const rpcAfterFirst = rpc.mock.calls.length;

    // 写入 marker（真实脚本第一次已写，这里显式确认存在后二次调用）
    expect(existsSync(markerPath)).toBe(true);
    await runScheduledTasksMigration(gm, service);

    const afterSecond = (await taskRepo.list({})).length;
    expect(afterSecond).toBe(afterFirst);
    expect(rpc.mock.calls.length).toBe(rpcAfterFirst); // 二次无新 rpc
    // 第二次因 marker 命中早返回，不刷新
    expect(refreshSchedule).toHaveBeenCalledTimes(1);
  });

  it('resumes on crash: re-running without marker skips existing rows', async () => {
    const { gm, rpc } = makeGm();
    const { service } = makeServiceStub();
    const { runScheduledTasksMigration } = await import('../../electron/scripts/migrate-scheduled-tasks');

    // 预先插入一条 claude（模拟上次崩溃前已写入）
    await taskRepo.create({
      id: 'claude-1',
      name: 'claude daily',
      cronExpr: '0 9 * * *',
      engineType: 'claude',
      prompt: 'partial',
      agentId: 'agent-claude',
    });

    // 删 marker 模拟崩溃未写
    await runScheduledTasksMigration(gm, service);

    const tasks = await taskRepo.list({});
    expect(tasks).toHaveLength(3); // claude-1 复用 + openclaw-1 + openclaw-disabled
    const claude = tasks.find((t) => t.id === 'claude-1')!;
    // 已存在的行不被覆盖（prompt 仍为 partial，非 claude prompt）
    expect(claude.prompt).toBe('partial');
    // openclaw 两条仍被迁移 + remove
    const removes = rpc.mock.calls.filter((c) => c[0] === 'cron.remove');
    expect(removes).toHaveLength(2);
  });

  it('skips non-cron openclaw jobs without removing them', async () => {
    const { gm, rpc } = makeGm();
    const { service } = makeServiceStub();
    const { runScheduledTasksMigration } = await import('../../electron/scripts/migrate-scheduled-tasks');

    // 覆盖 gm 让 cron.list 返回一条 everyMs（非 cron）
    const gmEvery = {
      rpc: vi.fn(async (method: string) => {
        if (method === 'cron.list')
          return {
            jobs: [
              {
                id: 'interval-job',
                name: 'every 5m',
                enabled: true,
                schedule: { kind: 'every', everyMs: 300000 },
                payload: { message: 'boom' },
              },
            ],
          };
        if (method === 'cron.remove') return undefined;
        throw new Error(`unexpected ${method}`);
      }),
    } as unknown as GatewayManager;

    await runScheduledTasksMigration(gmEvery, service);

    const tasks = await taskRepo.list({});
    expect(tasks).toHaveLength(1); // 仅 claude
    expect(tasks[0].id).toBe('claude-1');
    // 非 cron 任务不 remove
    const removes = rpc.mock.calls.filter((c) => c[0] === 'cron.remove');
    expect(removes).toHaveLength(0);
  });
});
