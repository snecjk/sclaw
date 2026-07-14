import { getKyselyDatabase } from '../connection';

/**
 * Workflow-runtime DAO.
 *
 * Persists the 7 `wf_*` tables created by migration 0002. Mirrors the
 * `demo-record-repository.ts` style: a thin Kysely layer over
 * `getKyselyDatabase()` plus a `nowIso()` helper for ISO-8601 timestamps.
 *
 * Upserts use Kysely's `onConflict(...).doUpdateSet(...)` which compiles to
 * standard SQLite `INSERT ... ON CONFLICT (cols) DO UPDATE SET ...` SQL. The
 * `node:sqlite` adapter executes that SQL verbatim (it only wraps
 * `prepare/run/all`), so the upsert runs as a single atomic statement rather
 * than a select-then-update round-trip. Confirmed working via the SQLite
 * driver's `lastInsertRowid` -> `insertId` mapping used by `enqueueOutbox`.
 */

function nowIso(): string {
  return new Date().toISOString();
}

export class WorkflowRuntimeRepository {
  /**
   * Insert-or-replace a workflow run by `run_id`. Always refreshes `updated_at`
   * so the row reports the most recent mutation regardless of caller input.
   */
  async upsertRun(r: any): Promise<void> {
    const db = getKyselyDatabase();
    const row: any = { ...r, updated_at: nowIso() };
    await db
      .insertInto('wf_run')
      .values(row)
      .onConflict((eb) => eb.column('run_id').doUpdateSet(row))
      .execute();
  }

  async getRun(run_id: string): Promise<any> {
    const db = getKyselyDatabase();
    return db
      .selectFrom('wf_run')
      .selectAll()
      .where('run_id', '=', run_id)
      .executeTakeFirst();
  }

  async listRunsByStatus(statuses: string[]): Promise<any[]> {
    const db = getKyselyDatabase();
    if (!statuses || statuses.length === 0) {
      return [];
    }
    return db
      .selectFrom('wf_run')
      .selectAll()
      .where('status', 'in', statuses)
      .orderBy('updated_at', 'desc')
      .orderBy('run_id', 'asc')
      .execute();
  }

  /**
   * Insert-or-replace a node-run row by the composite key `(run_id, node_id)`.
   */
  async upsertNodeRun(n: any): Promise<void> {
    const db = getKyselyDatabase();
    await db
      .insertInto('wf_node_run')
      .values(n)
      .onConflict((eb) => eb.columns(['run_id', 'node_id']).doUpdateSet(n))
      .execute();
  }

  async listNodeRuns(run_id: string): Promise<any[]> {
    const db = getKyselyDatabase();
    return db
      .selectFrom('wf_node_run')
      .selectAll()
      .where('run_id', '=', run_id)
      .orderBy('started_at', 'asc')
      .orderBy('node_id', 'asc')
      .execute();
  }

  /**
   * Atomically increment `attempt_count` for one node-run. Used by the executor
   * when retrying a node.
   */
  async incrementNodeAttempt(run_id: string, node_id: string): Promise<void> {
    const db = getKyselyDatabase();
    await db
      .updateTable('wf_node_run')
      .set((eb: any) => ({ attempt_count: eb('attempt_count', '+', 1) }))
      .where('run_id', '=', run_id)
      .where('node_id', '=', node_id)
      .execute();
  }

  /**
   * Append an audit event. Stamps `created_at` server-side.
   */
  async insertEvent(e: any): Promise<void> {
    const db = getKyselyDatabase();
    await db
      .insertInto('wf_event')
      .values({ ...e, created_at: nowIso() })
      .execute();
  }

  async upsertArtifact(a: any): Promise<void> {
    const db = getKyselyDatabase();
    await db
      .insertInto('wf_artifact')
      .values(a)
      .onConflict((eb) => eb.column('artifact_id').doUpdateSet(a))
      .execute();
  }

  async upsertApprovalTask(t: any): Promise<void> {
    const db = getKyselyDatabase();
    await db
      .insertInto('wf_approval_task')
      .values(t)
      .onConflict((eb) => eb.column('task_id').doUpdateSet(t))
      .execute();
  }

  async upsertUserInputTask(t: any): Promise<void> {
    const db = getKyselyDatabase();
    await db
      .insertInto('wf_user_input_task')
      .values(t)
      .onConflict((eb) => eb.column('task_id').doUpdateSet(t))
      .execute();
  }

  /**
   * Enqueue an outbox row for a sync run. Returns the autoincrement `id` so the
   * caller can track / mark the exact row.
   */
  async enqueueOutbox(
    run_id: string,
    entity_type: string,
    entity_ref: string,
    payload: unknown,
    sync_kind: string,
  ): Promise<number> {
    const db = getKyselyDatabase();
    const result = await db
      .insertInto('wf_outbox')
      .values({
        run_id,
        entity_type,
        entity_ref,
        payload: JSON.stringify(payload),
        sync_kind,
        status: 'pending',
        attempts: 0,
        created_at: nowIso(),
      })
      .executeTakeFirstOrThrow();
    return Number(result.insertId);
  }

  /**
   * List pending outbox rows ready to flush: status='pending' AND
   * (next_retry_at IS NULL OR next_retry_at <= now). Ordered by `id` ascending
   * (G7 invariant): id is AUTOINCREMENT and thus increases with `created_at`,
   * so this yields strict created-at FIFO for the flusher.
   */
  async listPendingOutbox(limit: number): Promise<any[]> {
    const db = getKyselyDatabase();
    return db
      .selectFrom('wf_outbox')
      .selectAll()
      .where('status', '=', 'pending')
      .where((eb: any) =>
        eb.or([eb('next_retry_at', 'is', null), eb('next_retry_at', '<=', nowIso())]),
      )
      .orderBy('id', 'asc')
      .limit(limit)
      .execute();
  }

  /**
   * Mark outbox rows as synced (the entity has been acknowledged by the cloud).
   * No-op for an empty id list to avoid generating `... where id in ()`.
   */
  async markOutboxSynced(ids: number[]): Promise<void> {
    if (!ids || ids.length === 0) {
      return;
    }
    const db = getKyselyDatabase();
    await db
      .updateTable('wf_outbox')
      .set({ status: 'synced', synced_at: nowIso() })
      .where('id', 'in', ids)
      .execute();
  }

  /**
   * Bump the retry counter and schedule the next attempt for a batch of rows.
   * No-op for an empty id list.
   */
  async bumpOutboxAttempts(ids: number[], nextRetryAt: string): Promise<void> {
    if (!ids || ids.length === 0) {
      return;
    }
    const db = getKyselyDatabase();
    await db
      .updateTable('wf_outbox')
      .set((eb: any) => ({
        attempts: eb('attempts', '+', 1),
        next_retry_at: nextRetryAt,
      }))
      .where('id', 'in', ids)
      .execute();
  }
}

let _repo: WorkflowRuntimeRepository | undefined;

export function getWorkflowRuntimeRepository(): WorkflowRuntimeRepository {
  return (_repo ??= new WorkflowRuntimeRepository());
}
