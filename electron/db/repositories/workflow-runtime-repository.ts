import { getKyselyDatabase } from '../connection';
import { formatShanghaiIso } from '../../../shared/workflow-timestamp';
import { takeWorkflowDatabaseId } from '../../services/workflow-runtime/id-pool';

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
  return formatShanghaiIso();
}

export function toCloudWorkflowRunPayload(
  source: Record<string, unknown>,
): Record<string, unknown> {
  const { trigger_type: _localTriggerType, ...cloudRun } = source;
  return cloudRun;
}

export class WorkflowRuntimeRepository {
  private async runDatabaseId(runRef: string | number): Promise<number> {
    if (typeof runRef === 'number') return runRef;
    const row = await getKyselyDatabase().selectFrom('wf_run').select('id')
      .where('run_id', '=', runRef).executeTakeFirst();
    if (!row) throw new Error(`workflow run not found: ${runRef}`);
    return row.id;
  }

  /**
   * Insert-or-replace a workflow run by `run_id`. Always refreshes `updated_at`
   * so the row reports the most recent mutation regardless of caller input.
   */
  async upsertRun(r: any): Promise<void> {
    const db = getKyselyDatabase();
    const row: any = { ...r, updated_at: nowIso() };
    const existing = await db
      .selectFrom('wf_run')
      .select('run_id')
      .where('run_id', '=', row.run_id)
      .executeTakeFirst();

    if (existing) {
      await db
        .updateTable('wf_run')
        .set(row)
        .where('run_id', '=', row.run_id)
        .execute();
      return;
    }

    await db
      .insertInto('wf_run')
      .values({ ...row, id: row.id ?? await takeWorkflowDatabaseId(), created_at: row.created_at ?? nowIso() })
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

  async registerChatRunCard(run_id: string, metadata: {
    sessionKey: string;
    anchorUserMessageId?: string | null;
    title?: string | null;
    paramsSummary?: string | null;
  }): Promise<boolean> {
    const db = getKyselyDatabase();
    const existing = await db
      .selectFrom('wf_run')
      .select(['session_key', 'chat_anchor_user_message_id', 'chat_card_title', 'chat_params_summary'])
      .where('run_id', '=', run_id)
      .executeTakeFirst();
    if (!existing) return false;
    if (existing.session_key && existing.session_key !== metadata.sessionKey) return false;

    const result = await db
      .updateTable('wf_run')
      .set({
        session_key: existing.session_key ?? metadata.sessionKey,
        chat_card_visible: 1,
        chat_anchor_user_message_id: metadata.anchorUserMessageId ?? existing.chat_anchor_user_message_id,
        chat_card_title: metadata.title ?? existing.chat_card_title,
        chat_params_summary: metadata.paramsSummary ?? existing.chat_params_summary,
        updated_at: nowIso(),
      })
      .where('run_id', '=', run_id)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0) > 0;
  }

  async listChatRunCardRefsBySession(session_key: string): Promise<any[]> {
    return getKyselyDatabase()
      .selectFrom('wf_run')
      .select([
        'run_id', 'workflow_id', 'session_key', 'chat_anchor_user_message_id', 'chat_card_title',
        'chat_params_summary', 'started_at',
      ])
      .where('session_key', '=', session_key)
      .where('chat_card_visible', '=', 1)
      .where('deleted_at', 'is', null)
      .orderBy('started_at', 'asc')
      .orderBy('run_id', 'asc')
      .execute();
  }

  async isChatRunCardVisible(run_id: string): Promise<boolean> {
    const row = await getKyselyDatabase()
      .selectFrom('wf_run')
      .select('run_id')
      .where('run_id', '=', run_id)
      .where('chat_card_visible', '=', 1)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return Boolean(row);
  }

  /**
   * Status/detail projection. The persisted definition stays in Main and is
   * used to resolve node IDs to the user-edited canvas names; the mapper does
   * not forward the definition to Renderer. Startup input and agent-result
   * bodies remain excluded from this polling path.
   */
  async getRunSummary(run_id: string, options: { includeTimelineText?: boolean } = {}): Promise<any> {
    const db = getKyselyDatabase();
    const base = db
      .selectFrom('wf_run')
      .where('run_id', '=', run_id);
    const columns = [
        'run_id', 'workflow_id', 'status', 'waiting_node_id', 'definition_json', 'output_json',
        'error', 'started_at', 'completed_at',
      ] as const;
    if (options.includeTimelineText) {
      return base.select([...columns, 'last_agent_raw_text']).executeTakeFirst();
    }
    return base.select(columns).executeTakeFirst();
  }

  /** Update a run only while it is non-terminal. Returns whether a row changed. */
  async updateRunIfActive(run_id: string, patch: any): Promise<boolean> {
    const db = getKyselyDatabase();
    const result = await db
      .updateTable('wf_run')
      .set({ ...patch, updated_at: nowIso() })
      .where('run_id', '=', run_id)
      .where('status', 'not in', ['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'])
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0) > 0;
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
   * Return the most recent client-local runs for one workflow. This intentionally
   * returns summary rows only: the renderer loads children lazily through
   * `workflow-runtime:getRun` after the user chooses a record.
   */
  async listLocalRunSummaries(workflow_id: string, limit = 50): Promise<any[]> {
    const db = getKyselyDatabase();
    return db
      .selectFrom('wf_run')
      .select(['run_id', 'workflow_id', 'version_id', 'workflow_version', 'definition_json', 'status', 'started_at', 'completed_at', 'engine_type', 'engine_model'])
      .where('workflow_id', '=', workflow_id)
      .where('mode', '=', 'CLIENT_LOCAL')
      .where('source', '=', 'client')
      .orderBy('started_at', 'desc')
      .orderBy('run_id', 'desc')
      .limit(Math.min(Math.max(limit, 1), 50))
      .execute();
  }

  /**
   * Insert-or-replace a node-run row by the composite key `(run_id, node_id)`.
   */
  async upsertNodeRun(n: any): Promise<void> {
    const db = getKyselyDatabase();
    const businessRunId = n.run_id;
    const runPk = await this.runDatabaseId(businessRunId);
    const stored = { ...n, run_id: runPk, updated_at: nowIso() };
    const existing = await db
      .selectFrom('wf_node_run')
      .select(['run_id', 'node_id'])
      .where('run_id', '=', runPk)
      .where('node_id', '=', n.node_id)
      .executeTakeFirst();

    if (existing) {
      await db
        .updateTable('wf_node_run')
        .set(stored)
        .where('run_id', '=', runPk)
        .where('node_id', '=', n.node_id)
        .execute();
      return;
    }

    await db
      .insertInto('wf_node_run')
      .values({
        ...stored,
        id: n.id ?? await takeWorkflowDatabaseId(),
        status: n.status ?? 'PENDING',
        attempt_count: n.attempt_count ?? 0,
        created_at: n.created_at ?? nowIso(),
      })
      .execute();
  }

  async listNodeRuns(run_id: string): Promise<any[]> {
    const db = getKyselyDatabase();
    const runPk = await this.runDatabaseId(run_id);
    const rows = await db
      .selectFrom('wf_node_run')
      .selectAll()
      .where('run_id', '=', runPk)
      .orderBy('started_at', 'asc')
      .orderBy('node_id', 'asc')
      .execute();
    return rows.map((row) => ({ ...row, run_id }));
  }

  /** Compact projection for status cards/polling; excludes prompt and packet bodies. */
  async listNodeRunSummaries(run_id: string): Promise<any[]> {
    const db = getKyselyDatabase();
    const runPk = await this.runDatabaseId(run_id);
    const rows = await db
      .selectFrom('wf_node_run')
      .select([
        'run_id', 'node_id', 'node_type', 'status', 'started_at', 'completed_at',
        'last_completion_issue',
      ])
      .where('run_id', '=', runPk)
      .orderBy('started_at', 'asc')
      .orderBy('node_id', 'asc')
      .execute();
    return rows.map((row) => ({ ...row, run_id }));
  }

  async getNodeRun(run_id: string, node_id: string): Promise<any> {
    const db = getKyselyDatabase();
    const runPk = await this.runDatabaseId(run_id);
    const row = await db
      .selectFrom('wf_node_run')
      .selectAll()
      .where('run_id', '=', runPk)
      .where('node_id', '=', node_id)
      .executeTakeFirst();
    return row ? { ...row, run_id } : row;
  }

  async markInflightNodeRunsInterrupted(run_id: string): Promise<void> {
    const db = getKyselyDatabase();
    const runPk = await this.runDatabaseId(run_id);
    await db
      .updateTable('wf_node_run')
      .set({ status: 'INTERRUPTED', completed_at: nowIso() })
      .where('run_id', '=', runPk)
      .where('status', 'in', ['RUNNING', 'WAITING_APPROVAL', 'WAITING_INPUT'])
      .execute();
  }

  /**
   * Atomically increment `attempt_count` for one node-run. Used by the executor
   * when retrying a node.
   */
  async incrementNodeAttempt(run_id: string, node_id: string): Promise<void> {
    const db = getKyselyDatabase();
    const runPk = await this.runDatabaseId(run_id);
    await db
      .updateTable('wf_node_run')
      .set((eb: any) => ({ attempt_count: eb('attempt_count', '+', 1) }))
      .where('run_id', '=', runPk)
      .where('node_id', '=', node_id)
      .execute();
  }

  /**
   * Append an audit event. Stamps `created_at` server-side.
   */
  async insertEvent(e: any): Promise<void> {
    const db = getKyselyDatabase();
    const runPk = await this.runDatabaseId(e.run_id);
    await db
      .insertInto('wf_event')
      .values({ ...e, id: e.id ?? await takeWorkflowDatabaseId(), run_id: runPk, created_at: nowIso(), updated_at: nowIso() })
      .execute();
  }

  async listEvents(run_id: string): Promise<any[]> {
    const db = getKyselyDatabase();
    const runPk = await this.runDatabaseId(run_id);
    const rows = await db
      .selectFrom('wf_event')
      .selectAll()
      .where('run_id', '=', runPk)
      .orderBy('sequence', 'asc')
      .execute();
    return rows.map((row) => ({ ...row, run_id }));
  }

  async nextEventSequence(run_id: string): Promise<number> {
    const db = getKyselyDatabase();
    const runPk = await this.runDatabaseId(run_id);
    const row = await db
      .selectFrom('wf_event')
      .select((eb: any) => eb.fn.max('sequence').as('max_sequence'))
      .where('run_id', '=', runPk)
      .executeTakeFirst();
    return Number((row as any)?.max_sequence ?? 0) + 1;
  }

  async upsertArtifact(a: any): Promise<void> {
    const db = getKyselyDatabase();
    const runPk = await this.runDatabaseId(a.run_id);
    const existing = await db.selectFrom('wf_artifact').select('id').where('artifact_id', '=', a.artifact_id).executeTakeFirst();
    const row = { ...a, id: existing?.id ?? a.id ?? await takeWorkflowDatabaseId(), run_id: runPk,
      node_id: a.node_id ?? '', uri: a.uri ?? `artifact://${a.run_id}/${a.node_id ?? ''}/${a.artifact_id}`,
      updated_at: nowIso() };
    await db
      .insertInto('wf_artifact')
      .values(row)
      .onConflict((eb) => eb.column('artifact_id').doUpdateSet(row))
      .execute();
  }

  async listArtifacts(run_id: string): Promise<any[]> {
    const runPk = await this.runDatabaseId(run_id);
    const rows = await getKyselyDatabase().selectFrom('wf_artifact').selectAll()
      .where('run_id', '=', runPk).orderBy('created_at', 'asc').execute();
    return rows.map((row) => ({ ...row, run_id }));
  }

  async upsertApprovalTask(t: any): Promise<void> {
    const db = getKyselyDatabase();
    const runPk = await this.runDatabaseId(t.run_id);
    const existing = await db.selectFrom('wf_approval_task').select('id').where('task_id', '=', t.task_id).executeTakeFirst();
    const row = { ...t, id: existing?.id ?? t.id ?? await takeWorkflowDatabaseId(), run_id: runPk,
      node_id: t.node_id ?? '', requested_at: t.requested_at ?? nowIso(), updated_at: nowIso() };
    await db
      .insertInto('wf_approval_task')
      .values(row)
      .onConflict((eb) => eb.column('task_id').doUpdateSet(row))
      .execute();
  }

  async listApprovalTasks(run_id: string): Promise<any[]> {
    const runPk = await this.runDatabaseId(run_id);
    const rows = await getKyselyDatabase().selectFrom('wf_approval_task').selectAll()
      .where('run_id', '=', runPk).orderBy('requested_at', 'asc').execute();
    return rows.map((row) => ({ ...row, run_id }));
  }

  async upsertUserInputTask(t: any): Promise<void> {
    const db = getKyselyDatabase();
    const runPk = await this.runDatabaseId(t.run_id);
    const existing = await db.selectFrom('wf_user_input_task').select('id').where('task_id', '=', t.task_id).executeTakeFirst();
    const row = { ...t, id: existing?.id ?? t.id ?? await takeWorkflowDatabaseId(), run_id: runPk,
      node_id: t.node_id ?? '', form_schema_json: t.form_schema_json ?? '[]',
      requested_at: t.requested_at ?? nowIso(), updated_at: nowIso() };
    await db
      .insertInto('wf_user_input_task')
      .values(row)
      .onConflict((eb) => eb.column('task_id').doUpdateSet(row))
      .execute();
  }

  async listUserInputTasks(run_id: string): Promise<any[]> {
    const runPk = await this.runDatabaseId(run_id);
    const rows = await getKyselyDatabase().selectFrom('wf_user_input_task').selectAll()
      .where('run_id', '=', runPk).orderBy('requested_at', 'asc').execute();
    return rows.map((row) => ({ ...row, run_id }));
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
    const normalizedPayload = await this.cloudPayload(run_id, entity_type, payload);
    const result = await db
      .insertInto('wf_outbox')
      .values({
        run_id,
        entity_type,
        entity_ref,
        payload: JSON.stringify(normalizedPayload),
        sync_kind,
        status: 'pending',
        attempts: 0,
        created_at: nowIso(),
      })
      .executeTakeFirstOrThrow();
    return Number(result.insertId);
  }

  /** Cloud child tables use workflow_run.id, while engine code addresses runs by run_id. */
  private async cloudPayload(runBizId: string, entityType: string, payload: unknown): Promise<unknown> {
    if (!payload || typeof payload !== 'object') return payload;
    const source = payload as Record<string, any>;
    if (entityType === 'run') {
      // trigger_type only drives local notification navigation. The cloud
      // workflow_run contract intentionally does not persist this UI origin.
      return toCloudWorkflowRunPayload(source);
    }
    const runPk = await this.runDatabaseId(runBizId);
    let stored: Record<string, any> | undefined;
    const db = getKyselyDatabase();
    if (entityType === 'node_run' && source.node_id) {
      stored = await db.selectFrom('wf_node_run').selectAll().where('run_id', '=', runPk)
        .where('node_id', '=', source.node_id).executeTakeFirst() as any;
    } else if (entityType === 'event' && source.sequence != null) {
      stored = await db.selectFrom('wf_event').selectAll().where('run_id', '=', runPk)
        .where('sequence', '=', Number(source.sequence)).executeTakeFirst() as any;
    } else if (entityType === 'artifact' && source.artifact_id) {
      stored = await db.selectFrom('wf_artifact').selectAll().where('artifact_id', '=', source.artifact_id).executeTakeFirst() as any;
    } else if (entityType === 'approval' && source.task_id) {
      stored = await db.selectFrom('wf_approval_task').selectAll().where('task_id', '=', source.task_id).executeTakeFirst() as any;
    } else if (entityType === 'user_input' && source.task_id) {
      stored = await db.selectFrom('wf_user_input_task').selectAll().where('task_id', '=', source.task_id).executeTakeFirst() as any;
    }
    // agent_session_id is a local executor identity.  The v2 sync contract
    // does not own or need an engine transcript identifier, so keep it out of
    // cloud payloads while still persisting it in the local node-run row.
    const { agent_session_id: _localAgentSessionId, ...cloudSource } = source;
    const storedRecord = stored ?? {};
    const { agent_session_id: _storedLocalAgentSessionId, ...cloudStored } = storedRecord;
    return { ...cloudSource, ...cloudStored, run_id: runPk };
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

  async markOutboxFailed(ids: number[]): Promise<void> {
    if (!ids || ids.length === 0) {
      return;
    }
    const db = getKyselyDatabase();
    await db
      .updateTable('wf_outbox')
      .set({ status: 'failed', synced_at: nowIso() })
      .where('id', 'in', ids)
      .execute();
  }

  async retryFailedOutbox(run_id?: string): Promise<void> {
    const db = getKyselyDatabase();
    let query: any = db.updateTable('wf_outbox')
      .set({ status: 'pending', attempts: 0, next_retry_at: null, synced_at: null })
      .where('status', '=', 'failed');
    if (run_id) query = query.where('run_id', '=', run_id);
    await query.execute();
  }
}

let _repo: WorkflowRuntimeRepository | undefined;

export function getWorkflowRuntimeRepository(): WorkflowRuntimeRepository {
  return (_repo ??= new WorkflowRuntimeRepository());
}
