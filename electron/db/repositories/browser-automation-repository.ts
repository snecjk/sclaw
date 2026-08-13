import { randomUUID } from 'node:crypto';
import { getKyselyDatabase } from '../connection';
import { formatShanghaiIso } from '../../../shared/workflow-timestamp';

const nowIso = () => formatShanghaiIso();

export class BrowserAutomationRepository {
  async upsertSession(row: {
    sessionId: string;
    source: 'embed' | 'managed';
    embedRuntimeId?: string | null;
    url?: string;
    title?: string;
    webContentsId?: number | null;
    automationPinned?: boolean;
  }): Promise<void> {
    const db = getKyselyDatabase();
    const ts = nowIso();
    const existing = await db.selectFrom('ba_session').select('session_id')
      .where('session_id', '=', row.sessionId).executeTakeFirst();

    const values = {
      session_id: row.sessionId,
      source: row.source,
      embed_runtime_id: row.embedRuntimeId ?? null,
      url: row.url ?? '',
      title: row.title ?? '',
      web_contents_id: row.webContentsId ?? null,
      automation_pinned: row.automationPinned ? 1 : 0,
      updated_at: ts,
      last_active_at: ts,
    };

    if (existing) {
      await db.updateTable('ba_session').set(values).where('session_id', '=', row.sessionId).execute();
      return;
    }

    await db.insertInto('ba_session').values({
      ...values,
      created_at: ts,
    }).execute();
  }

  async listSessions(): Promise<Array<Record<string, unknown>>> {
    const db = getKyselyDatabase();
    return db.selectFrom('ba_session').selectAll().orderBy('last_active_at desc').execute();
  }

  async getSession(sessionId: string): Promise<Record<string, unknown> | undefined> {
    const db = getKyselyDatabase();
    return db.selectFrom('ba_session').selectAll().where('session_id', '=', sessionId).executeTakeFirst();
  }

  async createRun(input: {
    runId?: string;
    sessionId: string;
    workflowRunId?: string | null;
    inputJson?: string | null;
  }): Promise<string> {
    const db = getKyselyDatabase();
    const runId = input.runId ?? randomUUID();
    const ts = nowIso();
    await db.insertInto('ba_run').values({
      run_id: runId,
      session_id: input.sessionId,
      workflow_run_id: input.workflowRunId ?? null,
      status: 'RUNNING',
      current_step_index: 0,
      input_json: input.inputJson ?? null,
      error: null,
      started_at: ts,
      completed_at: null,
    }).execute();
    return runId;
  }

  async upsertStepRun(row: {
    id?: string;
    runId: string;
    stepIndex: number;
    action: string;
    status: string;
    targetJson?: string | null;
    payloadJson?: string | null;
    observationJson?: string | null;
    validatorJson?: string | null;
    error?: string | null;
    durationMs?: number | null;
    startedAt?: string;
    completedAt?: string | null;
  }): Promise<void> {
    const db = getKyselyDatabase();
    const id = row.id ?? randomUUID();
    const existing = await db.selectFrom('ba_step_run').select('id')
      .where('run_id', '=', row.runId)
      .where('step_index', '=', row.stepIndex)
      .executeTakeFirst();

    const values = {
      id,
      run_id: row.runId,
      step_index: row.stepIndex,
      action: row.action,
      status: row.status,
      target_json: row.targetJson ?? null,
      payload_json: row.payloadJson ?? null,
      observation_json: row.observationJson ?? null,
      validator_json: row.validatorJson ?? null,
      error: row.error ?? null,
      duration_ms: row.durationMs ?? null,
      started_at: row.startedAt ?? nowIso(),
      completed_at: row.completedAt ?? null,
    };

    if (existing) {
      await db.updateTable('ba_step_run').set(values)
        .where('run_id', '=', row.runId)
        .where('step_index', '=', row.stepIndex)
        .execute();
    } else {
      await db.insertInto('ba_step_run').values(values).execute();
    }

    await db.updateTable('ba_run')
      .set({ current_step_index: row.stepIndex, status: 'RUNNING' })
      .where('run_id', '=', row.runId)
      .execute();
  }

  async listStepRuns(runId: string): Promise<Array<Record<string, unknown>>> {
    const db = getKyselyDatabase();
    return db.selectFrom('ba_step_run').selectAll()
      .where('run_id', '=', runId)
      .orderBy('step_index asc')
      .execute();
  }

  async getRun(runId: string): Promise<Record<string, unknown> | undefined> {
    const db = getKyselyDatabase();
    return db.selectFrom('ba_run').selectAll().where('run_id', '=', runId).executeTakeFirst();
  }

  async findLatestRunForWorkflow(
    workflowRunId: string,
    sessionId?: string,
  ): Promise<Record<string, unknown> | undefined> {
    const db = getKyselyDatabase();
    let query = db.selectFrom('ba_run')
      .selectAll()
      .where('workflow_run_id', '=', workflowRunId)
      .where('status', '=', 'RUNNING')
      .orderBy('started_at desc');
    if (sessionId) {
      query = query.where('session_id', '=', sessionId);
    }
    return query.executeTakeFirst();
  }

  async completeRun(runId: string, status: string, error?: string | null): Promise<void> {
    const db = getKyselyDatabase();
    await db.updateTable('ba_run').set({
      status,
      error: error ?? null,
      completed_at: nowIso(),
    }).where('run_id', '=', runId).execute();
  }
}

export const browserAutomationRepository = new BrowserAutomationRepository();
