// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupInMemoryDb, type InMemoryDb } from './helpers';
import { ScheduleTaskRepository } from '../../electron/db/repositories/schedule-task-repository';
import { runScheduleTasksPushTick } from '../../electron/scheduled-tasks/schedule-tasks-push';
import {
  computeScheduleTasksSyncStatus,
  pullScheduleTasksFromCloud,
} from '../../electron/scheduled-tasks/schedule-tasks-pull';
import type { CloudScheduleTaskRow } from '../../electron/scheduled-tasks/schedule-tasks-cloud-mapper';
import { SQLITE_MIGRATIONS } from '../../electron/db/migrations';

const baseInput = {
  name: 'Daily',
  cronExpr: '0 9 * * *',
  engineType: 'claude' as const,
  prompt: 'ping',
  agentId: 'agent-1',
  actor: '1165828',
};

function cloudFromLocal(overrides: Partial<CloudScheduleTaskRow> & { id: string }): CloudScheduleTaskRow {
  return {
    owner_user_id: '1165828',
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
    created_by: '1165828',
    updated_by: '1165828',
    ...overrides,
  };
}

describe('schedule-tasks cloud sync', () => {
  let env: InMemoryDb;
  let repo: ScheduleTaskRepository;

  beforeEach(() => {
    env = setupInMemoryDb();
    repo = new ScheduleTaskRepository();
  });

  afterEach(() => env.teardown());

  it('migration 0033 drops version and adds sync columns; tombstones are physically deleted', () => {
    const names = SQLITE_MIGRATIONS.map((m) => m.name);
    expect(names).toContain('schedule-tasks-cloud-sync');
    const cols = env.db.prepare('PRAGMA table_info(schedule_tasks)').all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('sync_status');
    expect(colNames).toContain('remote_version');
    expect(colNames).not.toContain('version');
  });

  it('E1/E4: local CRUD does not need network; sets pending and does not touch remote_version', async () => {
    const created = await repo.create(baseInput);
    expect(created.syncStatus).toBe('pending');
    expect(created.remoteVersion).toBeNull();

    await repo.applyPushSuccess(created.id, 3, created.updatedAt);
    const synced = await repo.getById(created.id);
    expect(synced?.syncStatus).toBe('done');
    expect(synced?.remoteVersion).toBe(3);

    const updated = await repo.update(created.id, { name: 'Renamed', actor: '1165828' });
    expect(updated?.syncStatus).toBe('pending');
    expect(updated?.remoteVersion).toBe(3);

    await repo.setEnabled(created.id, false, '1165828');
    const disabled = await repo.getById(created.id);
    expect(disabled?.syncStatus).toBe('pending');
    expect(disabled?.remoteVersion).toBe(3);
  });

  it('A3: updateScheduleState does not change sync_status / remote_version / updated_at', async () => {
    const created = await repo.create(baseInput);
    await repo.applyPushSuccess(created.id, 1, created.updatedAt);
    const before = await repo.getById(created.id);
    await repo.updateScheduleState(created.id, { nextRunAt: '2026-08-18T10:00:00.000Z' });
    const after = await repo.getById(created.id);
    expect(after?.syncStatus).toBe('done');
    expect(after?.remoteVersion).toBe(1);
    expect(after?.updatedAt).toBe(before?.updatedAt);
    expect(after?.nextRunAt).toBe('2026-08-18T10:00:00.000Z');
  });

  it('E6: push CAS keeps pending when updated_at changed in-flight', async () => {
    const created = await repo.create(baseInput);
    await repo.update(created.id, { prompt: 'newer', actor: '1165828' });
    const edited = await repo.getById(created.id);
    expect(edited?.syncStatus).toBe('pending');
    await repo.applyPushSuccess(created.id, 2, '2000-01-01T00:00:00.000Z');
    const after = await repo.getById(created.id);
    expect(after?.remoteVersion).toBe(2);
    expect(after?.syncStatus).toBe('pending');
  });

  it('malformed list (throw) skips tick and does not bootstrap', async () => {
    const created = await repo.create({ ...baseInput, name: 'Keep local' });
    const upsertCloud = vi.fn(async () => ({ id: created.id, version: 1 }));
    await runScheduleTasksPushTick('1165828', {
      taskRepo: repo,
      listCloud: async () => {
        throw new Error('云端 list 未返回任务列表');
      },
      upsertCloud,
    });
    expect(upsertCloud).not.toHaveBeenCalled();
    const after = await repo.getById(created.id);
    expect(after?.syncStatus).toBe('pending');
    expect(after?.remoteVersion).toBeNull();
  });

  it('E1: remote failure leaves pending', async () => {
    const created = await repo.create({ ...baseInput, name: 'Fail me' });
    const listCloud = vi.fn(async () => [] as CloudScheduleTaskRow[]);
    const upsertCloud = vi.fn(async () => {
      throw new Error('network down');
    });
    await runScheduleTasksPushTick('1165828', { taskRepo: repo, listCloud, upsertCloud });
    const after = await repo.getById(created.id);
    expect(after?.syncStatus).toBe('pending');
    expect(after?.remoteVersion).toBeNull();
  });

  it('E2: empty cloud (including no tombstones) pushes done rows; existing cloud only pending', async () => {
    const a = await repo.create({ ...baseInput, name: 'A' });
    const b = await repo.create({ ...baseInput, name: 'B' });
    await repo.applyPushSuccess(a.id, 1, a.updatedAt);
    expect((await repo.getById(a.id))?.syncStatus).toBe('done');

    const upsertEmpty = vi.fn(async (body: { id: string }) => ({ id: body.id, version: 4 }));
    await runScheduleTasksPushTick('1165828', {
      taskRepo: repo,
      listCloud: async () => [],
      upsertCloud: upsertEmpty,
    });
    expect(upsertEmpty).toHaveBeenCalledTimes(2);

    const upsertExisting = vi.fn(async (body: { id: string }) => ({ id: body.id, version: 5 }));
    await runScheduleTasksPushTick('1165828', {
      taskRepo: repo,
      listCloud: async () => [
        cloudFromLocal({ id: a.id, version: 4 }),
        cloudFromLocal({ id: b.id, version: 4 }),
      ],
      upsertCloud: upsertExisting,
    });
    expect(upsertExisting).toHaveBeenCalledTimes(0);
  });

  it('C5: missing id on non-empty cloud backfills remote_version only', async () => {
    const local = await repo.create({ ...baseInput, name: 'Keep done' });
    await repo.applyPushSuccess(local.id, 1, local.updatedAt);
    expect((await repo.getById(local.id))?.syncStatus).toBe('done');

    await runScheduleTasksPushTick('1165828', {
      taskRepo: repo,
      listCloud: async () => [cloudFromLocal({ id: 'other-cloud-id', version: 9, deleted_at: '2026-08-01T00:00:00.000Z' })],
      upsertCloud: async () => ({ id: local.id, version: 11 }),
    });
    const after = await repo.getById(local.id, { includeDeleted: true });
    expect(after?.remoteVersion).toBe(11);
    expect(after?.syncStatus).toBe('done');
  });

  it('E3: soft-delete pending push carries deleted_at; pull tombstones local active', async () => {
    const created = await repo.create(baseInput);
    await repo.softDelete(created.id, '1165828');
    const deleted = await repo.getById(created.id, { includeDeleted: true });
    expect(deleted?.deletedAt).toBeTruthy();
    expect(deleted?.syncStatus).toBe('pending');

    const upsertCloud = vi.fn(async (body: { deleted_at: string | null }) => {
      expect(body.deleted_at).toBeTruthy();
      return { id: created.id, version: 2 };
    });
    await runScheduleTasksPushTick('1165828', {
      taskRepo: repo,
      listCloud: async () => [],
      upsertCloud: upsertCloud as never,
    });

    const other = await repo.create({ ...baseInput, name: 'Alive', id: 'alive-1' });
    await pullScheduleTasksFromCloud('1165828', repo, async () => [
      cloudFromLocal({
        id: other.id,
        version: 3,
        deleted_at: '2026-08-18T12:00:00.000Z',
        updated_at: '2026-08-18T12:00:00.000Z',
      }),
    ]);
    const tombstoned = await repo.getById(other.id, { includeDeleted: true });
    expect(tombstoned?.deletedAt).toBe('2026-08-18T12:00:00.000Z');
    expect(tombstoned?.syncStatus).toBe('done');
    expect(tombstoned?.remoteVersion).toBe(3);
  });

  it('E5: sync-status counts missing / newer / remote deleted; local pending vs older cloud is ignored', async () => {
    const local = await repo.create({ ...baseInput, id: 'local-1' });
    await repo.applyPushSuccess(local.id, 1, local.updatedAt);
    const status = computeScheduleTasksSyncStatus(
      [(await repo.getById(local.id))!],
      [
        cloudFromLocal({ id: 'missing-active', version: 1 }),
        cloudFromLocal({ id: local.id, version: 4 }),
        cloudFromLocal({ id: 'cloud-deleted', version: 2, deleted_at: '2026-08-18T00:00:00.000Z' }),
      ],
    );
    expect(status.missingLocalCount).toBe(1);
    expect(status.cloudNewerCount).toBe(1);
    expect(status.hasCloudUpdates).toBe(true);
  });

  it('pull skips cloud tombstone when local has no id', async () => {
    const result = await pullScheduleTasksFromCloud('1165828', repo, async () => [
      cloudFromLocal({ id: 'ghost', version: 1, deleted_at: '2026-08-18T00:00:00.000Z' }),
    ]);
    expect(result.skippedTombstones).toBe(1);
    expect(await repo.getById('ghost', { includeDeleted: true })).toBeNull();
  });
});

describe('schedule-tasks ownership claim', () => {
  let env: InMemoryDb;
  let repo: ScheduleTaskRepository;
  let tmp: string;

  beforeEach(() => {
    env = setupInMemoryDb();
    repo = new ScheduleTaskRepository();
    tmp = mkdtempSync(join(tmpdir(), 'stoclaw-claim-'));
    vi.resetModules();
  });

  afterEach(() => {
    env.teardown();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('only fills created_by IS NULL; marker does not block later NULL claims; switch user does not re-claim owned', async () => {
    vi.doMock('../../electron/utils/paths', () => ({
      getStoClawHomeDir: () => tmp,
    }));
    const { claimScheduleTasksOwnership: claim } = await import(
      '../../electron/scheduled-tasks/schedule-tasks-ownership'
    );
    await repo.create({ ...baseInput, actor: null, name: 'orphan' });
    await repo.create({ ...baseInput, actor: '999999', name: 'owned' });

    const first = await claim('1165828', repo);
    expect(first.skipped).toBe(false);
    expect(first.claimed).toBe(1);
    const orphan = (await repo.list({ includeDeleted: true })).find((t) => t.name === 'orphan');
    const owned = (await repo.list({ includeDeleted: true })).find((t) => t.name === 'owned');
    expect(orphan?.createdBy).toBe('1165828');
    expect(orphan?.syncStatus).toBe('pending');
    expect(owned?.createdBy).toBe('999999');

    const second = await claim('000001', repo);
    expect(second.skipped).toBe(false);
    expect(second.claimed).toBe(0);
    expect((await repo.list({ includeDeleted: true })).find((t) => t.name === 'owned')?.createdBy).toBe(
      '999999',
    );

    await repo.create({ ...baseInput, actor: null, name: 'late-orphan' });
    const third = await claim('000001', repo);
    expect(third.skipped).toBe(false);
    expect(third.claimed).toBe(1);
    const late = (await repo.list({ includeDeleted: true })).find((t) => t.name === 'late-orphan');
    expect(late?.createdBy).toBe('000001');
    expect(late?.syncStatus).toBe('pending');
  });
});
