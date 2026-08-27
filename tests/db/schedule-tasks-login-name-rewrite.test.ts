// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupInMemoryDb, type InMemoryDb } from './helpers';
import { ScheduleTaskRepository } from '../../electron/db/repositories/schedule-task-repository';
import { pullScheduleTasksFromCloud } from '../../electron/scheduled-tasks/schedule-tasks-pull';
import type { CloudScheduleTaskRow } from '../../electron/scheduled-tasks/schedule-tasks-cloud-mapper';

const CODE = '2155991233';
const LOGIN_NAME = 'cjw';

const getAuthState = vi.fn(async () => ({
  user: { code: CODE, userName: LOGIN_NAME } as { code: string; userName?: string } | null,
}));

let stoHome = '';

vi.mock('../../electron/utils/auth-store', () => ({
  getAuthState: () => getAuthState(),
  // 用 getAuthState 的当前返回值模拟世代快照：mock 用户一切换，世代即翻转。
  getAuthSessionSnapshot: async () => ({
    key: JSON.stringify((await getAuthState()).user ?? null),
  }),
  isAuthSessionCurrent: async (snapshot: { key: string }) => (
    snapshot.key === JSON.stringify((await getAuthState()).user ?? null)
  ),
}));

vi.mock('../../electron/utils/paths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../electron/utils/paths')>();
  return {
    ...actual,
    getStoClawHomeDir: () => stoHome || actual.getStoClawHomeDir(),
  };
});

const listScheduleTasksCloud = vi.fn(async (): Promise<CloudScheduleTaskRow[]> => []);
vi.mock('../../electron/scheduled-tasks/schedule-tasks-cloud-client', () => ({
  listScheduleTasksCloud: () => listScheduleTasksCloud(),
}));

const baseInput = {
  name: 'Daily',
  cronExpr: '0 9 * * *',
  engineType: 'claude' as const,
  prompt: 'ping',
  agentId: 'agent-1',
};

function cloudFromLocal(overrides: Partial<CloudScheduleTaskRow> & { id: string }): CloudScheduleTaskRow {
  return {
    owner_user_id: CODE,
    name: 'Daily',
    enabled: 1,
    cron_expr: '0 9 * * *',
    engine_type: 'claude',
    prompt: 'ping',
    agent_id: 'agent-1',
    workflow_code: null,
    skill_code: null,
    dingtalk_recipients_json: null,
    model: null,
    provider: null,
    account_id: null,
    workspace_path: null,
    my_artifact_folder_path: null,
    shared_artifact_folder_path: null,
    permission_profile: null,
    timeout_sec: null,
    retry_policy_json: null,
    failure_policy_json: null,
    extra_json: null,
    next_run_at: null,
    last_scheduled_for: null,
    last_recovered_at: null,
    cron_expr_snapshot: null,
    created_at: '2026-08-18T00:00:00.000Z',
    updated_at: '2026-08-18T00:00:00.000Z',
    deleted_at: null,
    version: 1,
    created_by: LOGIN_NAME,
    updated_by: LOGIN_NAME,
    ...overrides,
  };
}

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error('timed out waiting for condition');
}

describe('schedule-tasks login-name created_by rewrite', () => {
  let env: InMemoryDb;
  let repo: ScheduleTaskRepository;

  beforeEach(() => {
    env = setupInMemoryDb();
    repo = new ScheduleTaskRepository();
    stoHome = mkdtempSync(join(tmpdir(), 'stoclaw-login-rewrite-'));
    getAuthState.mockReset();
    getAuthState.mockResolvedValue({ user: { code: CODE, userName: LOGIN_NAME } });
    listScheduleTasksCloud.mockReset();
    listScheduleTasksCloud.mockResolvedValue([]);
  });

  afterEach(() => {
    env.teardown();
    rmSync(stoHome, { recursive: true, force: true });
  });

  it('rewrites login-name rows (including soft-deleted) and leaves others alone', async () => {
    const { rewriteScheduleTasksLoginNameOwner } = await import(
      '../../electron/scheduled-tasks/schedule-tasks-ownership'
    );
    const loginNamed = await repo.create({ ...baseInput, name: 'mine-login', actor: LOGIN_NAME });
    const spaced = await repo.create({ ...baseInput, name: 'spaced', actor: ` ${LOGIN_NAME} ` });
    const alreadyCode = await repo.create({ ...baseInput, name: 'already', actor: CODE });
    await repo.applyPushSuccess(alreadyCode.id, 1, alreadyCode.updatedAt);
    const other = await repo.create({ ...baseInput, name: 'other', actor: '999999' });
    const orphan = await repo.create({ ...baseInput, name: 'orphan', actor: null });
    await repo.softDelete(loginNamed.id, LOGIN_NAME);

    const count = await rewriteScheduleTasksLoginNameOwner(CODE, LOGIN_NAME, repo);
    expect(count).toBe(2);

    const afterLogin = await repo.getById(loginNamed.id, { includeDeleted: true });
    expect(afterLogin?.createdBy).toBe(CODE);
    expect(afterLogin?.updatedBy).toBe(CODE);
    expect(afterLogin?.syncStatus).toBe('pending');
    expect(afterLogin?.deletedAt).toBeTruthy();

    expect((await repo.getById(spaced.id))?.createdBy).toBe(CODE);
    const afterAlready = await repo.getById(alreadyCode.id);
    expect(afterAlready?.createdBy).toBe(CODE);
    expect(afterAlready?.syncStatus).toBe('done');
    expect((await repo.getById(other.id))?.createdBy).toBe('999999');
    expect((await repo.getById(orphan.id))?.createdBy).toBeNull();

    expect(await repo.rewriteLoginNameCreatedBy(CODE, CODE)).toBe(0);
    expect(await repo.rewriteLoginNameCreatedBy(CODE, '')).toBe(0);
    expect(await repo.rewriteLoginNameCreatedBy('', LOGIN_NAME)).toBe(0);
  });

  it('rewrites login-name rows case-insensitively', async () => {
    const { rewriteScheduleTasksLoginNameOwner } = await import(
      '../../electron/scheduled-tasks/schedule-tasks-ownership'
    );
    const upper = await repo.create({ ...baseInput, name: 'upper', actor: LOGIN_NAME.toUpperCase() });
    const mixed = await repo.create({ ...baseInput, name: 'mixed', actor: 'CjW' });
    const other = await repo.create({ ...baseInput, name: 'other', actor: 'cjw2' });

    const count = await rewriteScheduleTasksLoginNameOwner(CODE, LOGIN_NAME, repo);
    expect(count).toBe(2);
    expect((await repo.getById(upper.id))?.createdBy).toBe(CODE);
    expect((await repo.getById(mixed.id))?.createdBy).toBe(CODE);
    expect((await repo.getById(other.id))?.createdBy).toBe('cjw2');
  });

  it('does not rewrite when userName equals code', async () => {
    const { rewriteScheduleTasksLoginNameOwner } = await import(
      '../../electron/scheduled-tasks/schedule-tasks-ownership'
    );
    await repo.create({ ...baseInput, actor: LOGIN_NAME });
    expect(await rewriteScheduleTasksLoginNameOwner(LOGIN_NAME, LOGIN_NAME, repo)).toBe(0);
    const rows = await repo.list({ includeDeleted: true, limit: 10 });
    expect(rows[0]?.createdBy).toBe(LOGIN_NAME);
  });

  it('onUserAuthenticated rewrites before startScheduler so list and nextRunAt work', async () => {
    const { ScheduledTaskService } = await import(
      '../../electron/scheduled-tasks/scheduled-task-service'
    );
    const svc = new ScheduledTaskService();
    const loginNamed = await repo.create({ ...baseInput, name: 'cron-me', actor: LOGIN_NAME });
    const other = await repo.create({ ...baseInput, name: 'not-mine', actor: '999999' });

    try {
      svc.onUserAuthenticated(CODE);
      await waitUntil(async () => {
        const mine = await repo.getById(loginNamed.id, { includeDeleted: true });
        return mine?.createdBy === CODE && Boolean(mine.nextRunAt);
      });
      const listed = await svc.listTasks();
      expect(listed.map((t) => t.id)).toContain(loginNamed.id);
      expect(listed.map((t) => t.id)).not.toContain(other.id);
      expect((await repo.getById(other.id))?.createdBy).toBe('999999');
    } finally {
      svc.stopScheduler();
    }
  });

  it('onUserAuthenticated skips the rewrite when the session switched to another user mid-flight', async () => {
    const { ScheduledTaskService } = await import(
      '../../electron/scheduled-tasks/scheduled-task-service'
    );
    const svc = new ScheduledTaskService();
    const loginNamed = await repo.create({ ...baseInput, name: 'stale-entry', actor: LOGIN_NAME });
    const codeOwned = await repo.create({ ...baseInput, name: 'owned', actor: CODE });
    // 入口 code 与读取时登录态之间已切号：user.code 不是入口 CODE，守卫放弃刷库。
    // userName 故意仍等于 LOGIN_NAME——没有守卫的话 loginNamed 会被误刷成 CODE。
    getAuthState.mockResolvedValue({ user: { code: '999999', userName: LOGIN_NAME } });

    try {
      svc.onUserAuthenticated(CODE);
      // codeOwned 写出 nextRunAt 说明 startScheduler 首轮 refresh 已跑，rewrite 窗口已过。
      await waitUntil(async () => Boolean((await repo.getById(codeOwned.id))?.nextRunAt));
      expect((await repo.getById(loginNamed.id, { includeDeleted: true }))?.createdBy).toBe(LOGIN_NAME);
    } finally {
      svc.stopScheduler();
    }
  });

  it('onUserAuthenticated aborts the whole chain when the login session flips mid-flight', async () => {
    const { ScheduledTaskService } = await import(
      '../../electron/scheduled-tasks/scheduled-task-service'
    );
    const svc = new ScheduledTaskService();
    const codeOwned = await repo.create({ ...baseInput, name: 'owned', actor: CODE });
    let calls = 0;
    // 首次（入口快照）仍是 CODE；随后世代翻转（登出/切号），后续步骤必须全部放弃。
    getAuthState.mockImplementation(async () => {
      calls += 1;
      return { user: calls === 1 ? { code: CODE, userName: LOGIN_NAME } : null };
    });

    try {
      svc.onUserAuthenticated(CODE);
      await new Promise((resolve) => setTimeout(resolve, 200));
      // startScheduler 未执行：首轮 refresh 不会写出 nextRunAt。
      expect((await repo.getById(codeOwned.id))?.nextRunAt).toBeNull();
    } finally {
      svc.stopScheduler();
    }
  });

  it('pullFromCloud covering with login-name created_by is rewritten back to employee code', async () => {
    const { rewriteScheduleTasksLoginNameOwner } = await import(
      '../../electron/scheduled-tasks/schedule-tasks-ownership'
    );
    const { ScheduledTaskService } = await import(
      '../../electron/scheduled-tasks/scheduled-task-service'
    );
    const local = await repo.create({ ...baseInput, actor: LOGIN_NAME });
    await rewriteScheduleTasksLoginNameOwner(CODE, LOGIN_NAME, repo);
    const rewritten = await repo.getById(local.id);
    expect(rewritten?.createdBy).toBe(CODE);
    expect(rewritten?.syncStatus).toBe('pending');

    listScheduleTasksCloud.mockResolvedValue([
      cloudFromLocal({
        id: local.id,
        version: 9,
        created_by: LOGIN_NAME,
        updated_by: LOGIN_NAME,
        updated_at: '2026-08-20T00:00:00.000Z',
      }),
    ]);

    const svc = new ScheduledTaskService();
    try {
      await svc.pullFromCloud();
      const after = await repo.getById(local.id);
      expect(after?.createdBy).toBe(CODE);
      expect(after?.updatedBy).toBe(CODE);
      expect(after?.syncStatus).toBe('pending');
      const listed = await svc.listTasks();
      expect(listed.map((t) => t.id)).toContain(local.id);
    } finally {
      svc.stopScheduler();
    }
  });

  it('pull without service rewrite would hide the row; rewrite after upsert restores it', async () => {
    const { rewriteScheduleTasksLoginNameOwner } = await import(
      '../../electron/scheduled-tasks/schedule-tasks-ownership'
    );
    const local = await repo.create({ ...baseInput, actor: LOGIN_NAME });
    await rewriteScheduleTasksLoginNameOwner(CODE, LOGIN_NAME, repo);

    await pullScheduleTasksFromCloud(CODE, repo, async () => [
      cloudFromLocal({
        id: local.id,
        version: 4,
        created_by: LOGIN_NAME,
        updated_by: LOGIN_NAME,
      }),
    ]);
    const covered = await repo.getById(local.id);
    expect(covered?.createdBy).toBe(LOGIN_NAME);
    expect(covered?.syncStatus).toBe('done');
    expect(await repo.list({ createdBy: CODE, limit: 10 })).toHaveLength(0);

    await rewriteScheduleTasksLoginNameOwner(CODE, LOGIN_NAME, repo);
    const restored = await repo.getById(local.id);
    expect(restored?.createdBy).toBe(CODE);
    expect(restored?.syncStatus).toBe('pending');
    expect(await repo.list({ createdBy: CODE, limit: 10 })).toHaveLength(1);
  });
});
