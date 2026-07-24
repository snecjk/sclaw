// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupInMemoryDb, type InMemoryDb } from './helpers';
import { ScheduleTaskRepository } from '../../electron/db/repositories/schedule-task-repository';
import type { GatewayManager } from '../../electron/gateway/manager';
import type { ScheduledTaskService } from '../../electron/scheduled-tasks/scheduled-task-service';

// paths 桩：definitions / openclaw jobs / marker 都进临时目录。
let claudeDir: string;
let openclawDir: string;
let homeDir: string;
vi.mock('../../electron/utils/paths', () => ({
  getClaudeScheduledTasksDir: () => claudeDir,
  getOpenClawConfigDir: () => openclawDir,
  getStoClawHomeDir: () => homeDir,
}));

vi.mock('../../electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

/**
 * Step 4 数据迁移：claude definitions.json + openclaw jobs.json（直读，不经 Gateway）
 * → schedule_tasks；迁成功后从 jobs.json 移除；marker 幂等 + 漏迁补洞。
 */
describe('runScheduledTasksMigration (data)', () => {
  let env: InMemoryDb;
  let taskRepo: ScheduleTaskRepository;
  let markerPath: string;
  let jobsPath: string;

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
    openclawDir = mkdtempSync(join(tmpdir(), 'mig-oc-'));
    homeDir = mkdtempSync(join(tmpdir(), 'mig-home-'));
    markerPath = join(homeDir, 'scheduled-tasks-migration.done');
    jobsPath = join(openclawDir, 'cron', 'jobs.json');

    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(claudeDir, 'definitions.json'),
      JSON.stringify({ definitions: claudeDefinitions }),
      'utf8',
    );

    mkdirSync(join(openclawDir, 'cron'), { recursive: true });
    writeFileSync(
      jobsPath,
      JSON.stringify({ version: 1, jobs: openclawJobs }, null, 2),
      'utf8',
    );
  });

  afterEach(() => {
    env.teardown();
    rmSync(claudeDir, { recursive: true, force: true });
    rmSync(openclawDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  });

  function makeGm() {
    // Gateway 在迁移期故意未连接；openclaw 不应再打 RPC。
    const rpc = vi.fn(async () => {
      throw new Error('Gateway not connected');
    });
    return { gm: { rpc } as unknown as GatewayManager, rpc };
  }

  function makeServiceStub() {
    const refreshSchedule = vi.fn(async () => undefined);
    return { service: { refreshSchedule } as unknown as ScheduledTaskService, refreshSchedule };
  }

  function readJobsFile(): { version?: number; jobs: Array<{ id: string }> } {
    return JSON.parse(readFileSync(jobsPath, 'utf8')) as {
      version?: number;
      jobs: Array<{ id: string }>;
    };
  }

  it('migrates both engines from disk, preserves ids, strips jobs.json, writes marker', async () => {
    const { gm, rpc } = makeGm();
    const { service, refreshSchedule } = makeServiceStub();
    const { runScheduledTasksMigration } = await import('../../electron/scripts/migrate-scheduled-tasks');

    await runScheduledTasksMigration(gm, service);

    const tasks = await taskRepo.list({});
    expect(tasks).toHaveLength(3);

    const ids = tasks.map((t) => t.id).sort();
    expect(ids).toEqual(['claude-1', 'openclaw-1', 'openclaw-disabled'].sort());

    const claude = tasks.find((t) => t.id === 'claude-1')!;
    expect(claude.engineType).toBe('claude');
    expect(claude.prompt).toBe('claude prompt');
    expect(claude.accountId).toBe('acct-1');
    expect(claude.permissionProfile).toBe('workspace-write');
    expect(claude.retryPolicy).toEqual({ maxAttempts: 2, backoffSec: 10 });

    const oc = tasks.find((t) => t.id === 'openclaw-1')!;
    expect(oc.engineType).toBe('openclaw');
    expect(oc.prompt).toBe('openclaw prompt');
    expect(oc.model).toBe('gpt-4o');
    expect(oc.agentId).toBe('agent-openclaw');
    expect(oc.workflowCode).toBe('wf-oc');
    expect(oc.dingtalkRecipients).toBeNull();

    const oc2 = tasks.find((t) => t.id === 'openclaw-disabled')!;
    expect(oc2.prompt).toBe('fallback text prompt');
    expect(oc2.enabled).toBe(false);

    // 不依赖 Gateway RPC
    expect(rpc).not.toHaveBeenCalled();

    // 已迁 cron 从 jobs.json 移除
    expect(readJobsFile().jobs).toEqual([]);

    expect(existsSync(markerPath)).toBe(true);
    expect(refreshSchedule).toHaveBeenCalledTimes(1);
  });

  it('skips claude when marker present; openclaw backfills leftovers without Gateway', async () => {
    const { gm, rpc } = makeGm();
    const { service, refreshSchedule } = makeServiceStub();
    const { runScheduledTasksMigration } = await import('../../electron/scripts/migrate-scheduled-tasks');

    // 模拟历史坏 marker：claude 已迁、openclaw 因 Gateway 未连为 0，jobs.json 仍在
    await taskRepo.create({
      id: 'claude-1',
      name: 'claude daily',
      cronExpr: '0 9 * * *',
      engineType: 'claude',
      prompt: 'claude prompt',
      agentId: 'agent-claude',
    });
    writeFileSync(
      markerPath,
      JSON.stringify({
        completedAt: '2026-07-23T13:31:46.756Z',
        claude: { migrated: 6, skipped: 0 },
        openclaw: { migrated: 0, skipped: 0, nonCron: 0 },
      }),
      'utf8',
    );

    await runScheduledTasksMigration(gm, service);

    const tasks = await taskRepo.list({});
    expect(tasks).toHaveLength(3);
    expect(tasks.map((t) => t.engineType).sort()).toEqual(['claude', 'openclaw', 'openclaw']);
    expect(readJobsFile().jobs).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
    expect(refreshSchedule).toHaveBeenCalledTimes(1);

    const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as {
      claude: { migrated: number };
      openclaw: { migrated: number };
    };
    expect(marker.claude.migrated).toBe(6); // 保留旧 claude 计数
    expect(marker.openclaw.migrated).toBe(2);
  });

  it('second run with clean jobs.json is a no-op', async () => {
    const { gm, rpc } = makeGm();
    const { service, refreshSchedule } = makeServiceStub();
    const { runScheduledTasksMigration } = await import('../../electron/scripts/migrate-scheduled-tasks');

    await runScheduledTasksMigration(gm, service);
    const afterFirst = (await taskRepo.list({})).length;

    await runScheduledTasksMigration(gm, service);

    expect((await taskRepo.list({})).length).toBe(afterFirst);
    expect(rpc).not.toHaveBeenCalled();
    expect(refreshSchedule).toHaveBeenCalledTimes(1);
  });

  it('resumes on crash: re-running without marker skips existing rows', async () => {
    const { gm } = makeGm();
    const { service } = makeServiceStub();
    const { runScheduledTasksMigration } = await import('../../electron/scripts/migrate-scheduled-tasks');

    await taskRepo.create({
      id: 'claude-1',
      name: 'claude daily',
      cronExpr: '0 9 * * *',
      engineType: 'claude',
      prompt: 'partial',
      agentId: 'agent-claude',
    });

    await runScheduledTasksMigration(gm, service);

    const tasks = await taskRepo.list({});
    expect(tasks).toHaveLength(3);
    const claude = tasks.find((t) => t.id === 'claude-1')!;
    expect(claude.prompt).toBe('partial');
    expect(readJobsFile().jobs).toEqual([]);
  });

  it('skips non-cron openclaw jobs and leaves them in jobs.json', async () => {
    writeFileSync(
      jobsPath,
      JSON.stringify({
        version: 1,
        jobs: [
          {
            id: 'interval-job',
            name: 'every 5m',
            enabled: true,
            schedule: { kind: 'every', everyMs: 300000 },
            payload: { message: 'boom' },
          },
        ],
      }),
      'utf8',
    );

    const { gm } = makeGm();
    const { service } = makeServiceStub();
    const { runScheduledTasksMigration } = await import('../../electron/scripts/migrate-scheduled-tasks');

    await runScheduledTasksMigration(gm, service);

    const tasks = await taskRepo.list({});
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('claude-1');
    expect(readJobsFile().jobs.map((j) => j.id)).toEqual(['interval-job']);
    expect(existsSync(markerPath)).toBe(true);
  });
});
