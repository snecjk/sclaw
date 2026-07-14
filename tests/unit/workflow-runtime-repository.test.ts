import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

/**
 * Reuses the documented test seam from `workflow-runtime-migration.test.ts`:
 * `initializeSqliteDatabase()` is a singleton deriving its file path from
 * `app.getPath('userData')`. We redirect the `electron` main-process `app` to a
 * throwaway temp dir so the real migration pipeline + Kysely client runs against
 * a temp-file SQLite database instead of the real userData path.
 *
 * `vi.hoisted` runs before module imports (and before the `vi.mock` factory) so
 * the temp path is available to both the mock factory and the test body.
 */
const tempUserDataDir = vi.hoisted(() => {
  const path = require('node:path');
  const os = require('node:os');
  const fs = require('node:fs');
  const dir = path.join(os.tmpdir(), `stoclaw-wf-repo-test-${process.pid}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
});

vi.mock('electron', () => ({
  app: {
    getPath: () => tempUserDataDir,
    isPackaged: false,
    getAppPath: () => tempUserDataDir,
  },
}));

import { getSqliteDatabase, initializeSqliteDatabase, getWorkflowRuntimeRepository } from '../../electron/db';

describe('WorkflowRuntimeRepository', () => {
  // Ensure the 7 wf_* tables exist (migrations run) before any repository call.
  beforeAll(() => {
    initializeSqliteDatabase();
  });

  afterAll(() => {
    // Release the file handle before removing the temp dir (WAL creates -wal/-shm siblings).
    try {
      getSqliteDatabase().close();
    } catch {
      // ignore — already closed or never opened
    }
    try {
      require('node:fs').rmSync(tempUserDataDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup; temp dir lives in os.tmpdir() regardless
    }
  });

  it('upserts a run by run_id (insert then update)', async () => {
    const repo = getWorkflowRuntimeRepository();
    const runId = 'r1';
    await repo.upsertRun({
      run_id: runId,
      workflow_id: 'wf-1',
      version_id: 'v1',
      status: 'RUNNING',
      mode: 'CLIENT_LOCAL',
      source: 'client',
      definition_json: '{}',
      started_at: new Date().toISOString(),
    });
    // 2nd upsert with the same run_id flips status to SUCCEEDED.
    await repo.upsertRun({
      run_id: runId,
      workflow_id: 'wf-1',
      version_id: 'v1',
      status: 'SUCCEEDED',
      mode: 'CLIENT_LOCAL',
      source: 'client',
      definition_json: '{}',
      started_at: new Date().toISOString(),
    });

    const row = await repo.getRun(runId);
    expect(row).toBeDefined();
    expect(row.status).toBe('SUCCEEDED');
  });

  it('upserts a node_run by (run_id, node_id) without duplicates', async () => {
    const repo = getWorkflowRuntimeRepository();
    const runId = 'r2';
    const nodeId = 'n1';
    const node = {
      run_id: runId,
      node_id: nodeId,
      node_type: 'LLM',
      status: 'RUNNING',
      attempt_count: 0,
    };
    await repo.upsertNodeRun(node);
    // 2nd upsert with the same composite key should replace, not duplicate.
    await repo.upsertNodeRun({ ...node, status: 'COMPLETED' });

    const rows = await repo.listNodeRuns(runId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('COMPLETED');
  });

  it('enqueues, lists pending, and marks outbox synced', async () => {
    const repo = getWorkflowRuntimeRepository();
    const runId = 'r3';
    const id = await repo.enqueueOutbox(
      runId,
      'node_run',
      'r3:n1',
      { hello: 'world' },
      'UPSERT',
    );

    // The enqueued id is returned and is a real numeric primary key.
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);

    let pending = await repo.listPendingOutbox(10);
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(id);
    expect(pending[0].status).toBe('pending');
    expect(pending[0].payload).toBe(JSON.stringify({ hello: 'world' }));

    await repo.markOutboxSynced([id]);

    pending = await repo.listPendingOutbox(10);
    expect(pending).toHaveLength(0);
  });
});
