import type { GatewayManager } from '../gateway/manager';
import { getKyselyDatabase } from '../db';
import { agentMemoryOrchestrator } from './agent-memory-orchestrator';
import { logger } from '../utils/logger';
import { getAdapterForSession } from '../engines/manager';
import type { ExecutionSnapshot } from '../engines/execution-snapshot';
import { extractDirectExecutionCommands, formatExecutionMemoryText, type ExecutionExperienceCandidateAssessment, type ExecutionExperienceSummary } from './claude-execution-summary-service';
import { sanitizeMemoryCaptureUserMessage } from '../../shared/memory-capture-text';
import { scheduleMemoryCaptureRetry } from './memory-capture-retry';

type RefreshInput = {
  runId?: string | null;
  sessionKey?: string | null;
  agentId?: string | null;
  engineType?: string | null;
  terminalStatus?: 'completed' | 'failed' | 'aborted' | null;
};
type CaptureContext = RefreshInput & { sourceId: string; sessionKey: string; executionJobId: string; conversationJobId: string };
type CapturePreparationPlan = { prepareConversation: boolean; prepareExecution: boolean };
type CaptureJobState = { id: string; status: string; payload_json: string; retry_count: number };
const HISTORY_READY_DELAY_MS = 500;
const CONVERSATION_MIN_TOTAL_LENGTH = 12;
const EXECUTION_MIN_TOOL_COUNT = 5;
const RETRY_BASE_DELAY_MS = 30000;
const SNAPSHOT_PREPARATION_STATUSES = new Set(['pending', 'retry_wait']);
const now = () => new Date().toISOString();
type LogFields = Record<string, unknown>;
type InjectedExecutionMemory = { memoryId: string; memory: string };
type ExecutionMemoryPayload = Record<string, unknown> & {
  _executionMemory?: {
    injected?: InjectedExecutionMemory[];
    summary?: unknown;
    newMemoryId?: string;
    deleteCandidates?: string[];
    deletedMemoryIds?: string[];
    cleanupPending?: boolean;
  };
};

function trace(level: 'info' | 'warn', event: string, fields: LogFields): void {
  logger[level](`[memory-capture] ${event} ${JSON.stringify(fields)}`);
}

class MemoryCaptureService {
  private running = new Set<string>();
  private preparing = new Set<string>();
  private injectedMemoriesByRun = new Map<string, { memories: InjectedExecutionMemory[]; createdAt: number }>();

  bindInjectedExecutionMemories(input: { runId?: string; memories?: Array<{ memoryId?: string; memory?: string }> }): void {
    const runId = input.runId?.trim();
    if (!runId) { trace('warn', 'execution.context.bind_skipped', { reason: 'missing_run_id' }); return; }
    const memories = (input.memories ?? [])
      .filter((item): item is { memoryId: string; memory: string } => typeof item?.memoryId === 'string' && item.memoryId.trim().length > 0 && typeof item.memory === 'string' && item.memory.trim().length > 0)
      .map((item) => ({ memoryId: item.memoryId.trim(), memory: item.memory.trim().slice(0, 1200) }));
    this.pruneInjectedMemoryBindings();
    this.injectedMemoriesByRun.set(runId, { memories, createdAt: Date.now() });
    trace('info', 'execution.context.bound', { runId, memoryIds: memories.map((item) => item.memoryId), count: memories.length });
  }

  discardInjectedExecutionMemories(runIdValue?: string | null): void {
    const runId = runIdValue?.trim();
    if (!runId) return;
    if (this.injectedMemoriesByRun.delete(runId)) {
      trace('info', 'execution.context.discarded', { runId });
    }
  }

  async capture(input: RefreshInput, gateway: GatewayManager): Promise<void> {
    await this.captureFromHistory(input, gateway);
  }

  private async captureFromHistory(input: RefreshInput, gateway: GatewayManager): Promise<void> {
    const context = this.createCaptureContext(input);
    if (!context) return;
    if (this.preparing.has(context.executionJobId)) {
      trace('info', 'capture.prepare.skip', { jobId: context.executionJobId, reason: 'already_preparing' });
      return;
    }

    this.preparing.add(context.executionJobId);
    let plan: CapturePreparationPlan | undefined;
    try {
      await this.ensureCaptureJobs(context);
      plan = await this.getPreparationPlan(context);
      if (!plan.prepareConversation && !plan.prepareExecution) return;

      trace('info', 'capture.prepare.requested', { jobId: context.executionJobId, runId: context.sourceId, sessionKey: context.sessionKey, agentId: input.agentId ?? null, engineType: input.engineType ?? null, ...plan });
      const snapshot = await this.loadTurnSnapshot(context, gateway, plan.prepareExecution);
      if (!snapshot) throw new Error('execution_history_not_ready');

      if (plan.prepareConversation) await this.prepareConversationFromSnapshot(context, snapshot);
      if (plan.prepareExecution) await this.prepareExecutionFromSnapshot(context, snapshot);
    } catch (error) {
      await this.retrySnapshotPreparation(context, plan, error, input, gateway);
    } finally {
      this.preparing.delete(context.executionJobId);
    }
  }

  private createCaptureContext(input: RefreshInput): CaptureContext | null {
    const sourceId = input.runId?.trim();
    const sessionKey = input.sessionKey?.trim();
    if (!sourceId || !sessionKey) {
      trace('warn', 'capture.prepare.skip', { reason: 'missing_run_or_session', runId: input.runId ?? null, sessionKey: input.sessionKey ?? null });
      return null;
    }
    return {
      ...input,
      sourceId,
      sessionKey,
      executionJobId: `execution_experience:${sourceId}`,
      conversationJobId: `conversation_memory:${sourceId}`,
    };
  }

  /** 历史快照尚未就绪时，两类记忆 job 同步处于 pending，等待同一次快照准备。 */
  private async ensureCaptureJobs(context: CaptureContext): Promise<void> {
    await Promise.all([
      this.insert('conversation_memory', context.sourceId, context, { sessionKey: context.sessionKey }, 'pending'),
      this.insert('execution_experience', context.sourceId, context, { sessionKey: context.sessionKey }, 'pending'),
    ]);
  }

  private async getPreparationPlan(context: CaptureContext): Promise<CapturePreparationPlan> {
    const db = getKyselyDatabase();
    const [executionJob, conversationJob] = await Promise.all([
      db.selectFrom('memory_capture_jobs').select(['id', 'status', 'payload_json', 'retry_count']).where('id', '=', context.executionJobId).executeTakeFirst(),
      db.selectFrom('memory_capture_jobs').select(['id', 'status', 'payload_json', 'retry_count']).where('id', '=', context.conversationJobId).executeTakeFirst(),
    ]);
    const plan = {
      prepareConversation: this.requiresSnapshotPreparation(conversationJob, 'conversation_memory'),
      prepareExecution: this.requiresSnapshotPreparation(executionJob, 'execution_experience'),
    };
    if (!plan.prepareConversation && !plan.prepareExecution) {
      trace('info', 'capture.prepare.skip', { executionJobId: context.executionJobId, executionStatus: executionJob?.status ?? null, conversationJobId: context.conversationJobId, conversationStatus: conversationJob?.status ?? null, reason: 'both_jobs_already_prepared' });
    }
    return plan;
  }

  private requiresSnapshotPreparation(job: CaptureJobState | undefined, kind: 'conversation_memory' | 'execution_experience'): boolean {
    if (!job || !SNAPSHOT_PREPARATION_STATUSES.has(job.status)) return false;
    return kind === 'conversation_memory'
      ? !this.hasConversationPayload(job.payload_json)
      : !this.hasExecutionPayload(job.payload_json);
  }

  private hasConversationPayload(payloadJson: string): boolean {
    try {
      const payload = JSON.parse(payloadJson) as Record<string, unknown>;
      return typeof payload.userMessage === 'string' && typeof payload.assistantMessage === 'string';
    } catch { return false; }
  }

  private hasExecutionPayload(payloadJson: string): boolean {
    try {
      const payload = JSON.parse(payloadJson) as Record<string, unknown>;
      return typeof payload.userMessage === 'string'
        && typeof payload.assistantMessage === 'string'
        && Array.isArray(payload.tools);
    } catch { return false; }
  }

  private async loadTurnSnapshot(
    context: CaptureContext,
    gateway: GatewayManager,
    requireCompleteTools: boolean,
  ): Promise<ExecutionSnapshot | null> {
    await new Promise((resolve) => setTimeout(resolve, HISTORY_READY_DELAY_MS));
    const adapter = await getAdapterForSession(context.sessionKey, context.engineType);
    const snapshotResult = await adapter.getExecutionSnapshot(
      { gatewayManager: gateway },
      { sessionKey: context.sessionKey, limit: 200 },
    );
    if (!snapshotResult.success) throw new Error(snapshotResult.error || 'execution_snapshot_failed');
    const snapshot = snapshotResult.result;
    if (!snapshot) return null;
    if (requireCompleteTools && snapshot.tools.some((tool) => tool.status === 'unknown')) {
      const executionJob = await getKyselyDatabase()
        .selectFrom('memory_capture_jobs')
        .select('retry_count')
        .where('id', '=', context.executionJobId)
        .executeTakeFirst();
      if ((executionJob?.retry_count ?? 0) < 2) {
        throw new Error('execution_tool_results_not_ready');
      }
    }
    return {
      ...snapshot,
      userMessage: sanitizeMemoryCaptureUserMessage(snapshot.userMessage),
    };
  }

  private async prepareConversationFromSnapshot(context: CaptureContext, snapshot: ExecutionSnapshot): Promise<void> {
    const userMessage = snapshot.userMessage.trim();
    const assistantMessage = snapshot.assistantMessage.trim();
    if (!userMessage || !assistantMessage || `${userMessage}${assistantMessage}`.length < CONVERSATION_MIN_TOTAL_LENGTH) {
      trace('info', 'conversation.skip', { reason: 'empty_or_too_short', sessionKey: context.sessionKey, runId: context.sourceId, userLength: userMessage.length, assistantLength: assistantMessage.length });
      await this.skipConversationJob(context.conversationJobId, 'empty_or_too_short');
      return;
    }
    await getKyselyDatabase().updateTable('memory_capture_jobs').set({ payload_json: JSON.stringify({ userMessage, assistantMessage }), status: 'ready', updated_at: now() }).where('id', '=', context.conversationJobId).execute();
    trace('info', 'conversation.ready', { jobId: context.conversationJobId, sourceId: context.sourceId, sessionKey: context.sessionKey, agentId: context.agentId ?? null, userLength: userMessage.length, assistantLength: assistantMessage.length });
    void this.process(context.conversationJobId);
  }

  private async prepareExecutionFromSnapshot(context: CaptureContext, snapshot: ExecutionSnapshot): Promise<void> {
    const skipReason = snapshot.tools.length === 0
      ? 'no_tools_in_turn'
      : snapshot.tools.length < EXECUTION_MIN_TOOL_COUNT
        ? 'too_few_tools'
        : null;
    if (skipReason) {
      await this.skipExecutionJob(context.executionJobId, skipReason, snapshot);
      return;
    }

    this.pruneInjectedMemoryBindings();
    const injected = this.injectedMemoriesByRun.get(context.sourceId)?.memories ?? [];
    this.injectedMemoriesByRun.delete(context.sourceId);
    const payload: ExecutionMemoryPayload = { ...snapshot, _executionMemory: { injected } };
    trace('info', 'execution.history.ready', { jobId: context.executionJobId, runId: context.sourceId, messageCount: snapshot.messageCount, toolCount: snapshot.tools.length, userLength: snapshot.userMessage.length, assistantLength: snapshot.assistantMessage.length });
    trace('info', 'execution.history.context_merged', { jobId: context.executionJobId, runId: context.sourceId, injectedMemoryIds: injected.map((item) => item.memoryId), count: injected.length });
    await getKyselyDatabase().updateTable('memory_capture_jobs').set({ payload_json: JSON.stringify(payload), status: 'ready', updated_at: now() }).where('id', '=', context.executionJobId).execute();
    void this.process(context.executionJobId);
  }

  private async skipExecutionJob(jobId: string, reason: string, snapshot: ExecutionSnapshot): Promise<void> {
    await getKyselyDatabase().updateTable('memory_capture_jobs').set({ status: 'skipped', skip_reason: reason, completed_at: now(), updated_at: now() }).where('id', '=', jobId).execute();
    trace('info', 'job.skipped', { jobId, kind: 'execution_experience', reason, toolCount: snapshot.tools.length, messageCount: snapshot.messageCount });
  }

  private async skipConversationJob(jobId: string, reason: string): Promise<void> {
    await getKyselyDatabase().updateTable('memory_capture_jobs').set({ status: 'skipped', skip_reason: reason, completed_at: now(), updated_at: now() }).where('id', '=', jobId).execute();
    trace('info', 'job.skipped', { jobId, kind: 'conversation_memory', reason });
  }

  private async retrySnapshotPreparation(
    context: CaptureContext,
    plan: CapturePreparationPlan | undefined,
    error: unknown,
    input: RefreshInput,
    gateway: GatewayManager,
  ): Promise<void> {
    const jobIds = [
      ...(plan?.prepareConversation !== false ? [context.conversationJobId] : []),
      ...(plan?.prepareExecution !== false ? [context.executionJobId] : []),
    ];
    const db = getKyselyDatabase();
    const jobs = await db.selectFrom('memory_capture_jobs').select(['id', 'retry_count']).where('id', 'in', jobIds).execute();
    const retryCount = Math.max(0, ...jobs.map((job) => job.retry_count)) + 1;
    const shouldRetry = retryCount < 3;
    const retryInMs = retryCount * RETRY_BASE_DELAY_MS;
    await db.updateTable('memory_capture_jobs').set({
      status: shouldRetry ? 'retry_wait' : 'failed',
      retry_count: retryCount,
      error_message: String(error).slice(0, 500),
      next_retry_at: shouldRetry ? new Date(Date.now() + retryInMs).toISOString() : null,
      completed_at: shouldRetry ? null : now(),
      updated_at: now(),
    }).where('id', 'in', jobIds).execute();
    trace('warn', shouldRetry ? 'capture.prepare.retry_wait' : 'capture.prepare.failed', { jobIds, retryCount, retryInMs: shouldRetry ? retryInMs : null, error: String(error).slice(0, 500) });
    if (shouldRetry) {
      const timer = setTimeout(() => void this.captureFromHistory(input, gateway), retryInMs);
      timer.unref?.();
    }
  }

  async recover(gateway: GatewayManager): Promise<void> {
    const db = getKyselyDatabase();
    const jobs = await db.selectFrom('memory_capture_jobs').selectAll().where('status', 'in', ['pending', 'ready', 'summarizing', 'retry_wait']).execute();
    trace('info', 'recovery.scan', { count: jobs.length });
    for (const job of jobs) {
      if (job.memory_kind === 'execution_experience' && this.requiresSnapshotPreparation(job, 'execution_experience')) {
        void this.captureFromHistory({ runId: job.source_id, sessionKey: job.session_key, agentId: job.agent_id, engineType: job.engine_type }, gateway);
      } else if (job.memory_kind === 'conversation_memory' && this.requiresSnapshotPreparation(job, 'conversation_memory')) {
        // 若执行 job 已终态但会话快照准备曾失败，仍需由同一编排入口补齐会话 job。
        // 同 run 的重复恢复会被 preparing 锁折叠。
        void this.captureFromHistory({ runId: job.source_id, sessionKey: job.session_key, agentId: job.agent_id, engineType: job.engine_type }, gateway);
      } else {
        if (job.status === 'retry_wait') await db.updateTable('memory_capture_jobs').set({ status: 'ready', updated_at: now() }).where('id', '=', job.id).execute();
        void this.process(job.id);
      }
    }
    const completed = await db.selectFrom('memory_capture_jobs').selectAll().where('status', '=', 'stored').where('memory_kind', '=', 'execution_experience').execute();
    for (const job of completed) await this.recoverPendingExecutionDeletes(job);
  }

  private async recoverPendingExecutionDeletes(job: { id: string; payload_json: string; memory_id: string | null }): Promise<void> {
    let payload: ExecutionMemoryPayload;
    try { payload = JSON.parse(job.payload_json) as ExecutionMemoryPayload; } catch { return; }
    const lifecycle = payload._executionMemory;
    if (!lifecycle?.cleanupPending || !Array.isArray(lifecycle.deleteCandidates)) return;
    const deleted = new Set(lifecycle.deletedMemoryIds ?? []);
    const pending = lifecycle.deleteCandidates.filter((memoryId) => typeof memoryId === 'string' && memoryId && !deleted.has(memoryId));
    if (!pending.length) return;
    trace('info', 'execution.memory.cleanup_recovery_start', { jobId: job.id, newMemoryId: lifecycle.newMemoryId ?? job.memory_id, pendingMemoryIds: pending });
    for (const memoryId of pending) {
      try {
        await agentMemoryOrchestrator.deleteMemory(memoryId);
        deleted.add(memoryId);
        trace('info', 'execution.memory.cleanup_recovery_deleted', { jobId: job.id, memoryId, newMemoryId: lifecycle.newMemoryId ?? job.memory_id });
      } catch (error) {
        trace('warn', 'execution.memory.cleanup_recovery_failed', { jobId: job.id, memoryId, error: String(error).slice(0, 500) });
      }
    }
    lifecycle.deletedMemoryIds = [...deleted];
    lifecycle.cleanupPending = lifecycle.deleteCandidates.some((memoryId) => !deleted.has(memoryId));
    await getKyselyDatabase().updateTable('memory_capture_jobs').set({ payload_json: JSON.stringify(payload), updated_at: now() }).where('id', '=', job.id).execute();
    trace('info', 'execution.memory.cleanup_recovery_done', { jobId: job.id, cleanupPending: lifecycle.cleanupPending, deletedMemoryIds: lifecycle.deletedMemoryIds });
  }

  private async insert(
    kind: 'conversation_memory' | 'execution_experience',
    sourceId: string,
    input: RefreshInput,
    payload: unknown,
    status: 'pending' | 'ready' = kind === 'conversation_memory' ? 'ready' : 'pending',
  ): Promise<boolean> {
    const timestamp = now();
    const id = `${kind}:${sourceId}`;
    const result = await getKyselyDatabase().insertInto('memory_capture_jobs').values({ id, source_id: sourceId, memory_kind: kind, status, payload_json: JSON.stringify(payload), session_key: input.sessionKey || null, agent_id: input.agentId || null, engine_type: input.engineType || null, memory_id: null, skip_reason: null, error_message: null, retry_count: 0, next_retry_at: null, created_at: timestamp, updated_at: timestamp, completed_at: null }).onConflict((oc) => oc.column('id').doNothing()).executeTakeFirst();
    const inserted = Number(result.numInsertedOrUpdatedRows ?? 0n) > 0;
    trace('info', 'job.insert', { jobId: id, kind, sourceId, inserted });
    return inserted;
  }

  private async process(id: string): Promise<void> {
    if (this.running.has(id)) { trace('info', 'job.process.skip', { jobId: id, reason: 'already_running' }); return; } this.running.add(id);
    const db = getKyselyDatabase();
    try {
      const job = await db.selectFrom('memory_capture_jobs').selectAll().where('id', '=', id).executeTakeFirst();
      if (!job || !['ready', 'summarizing'].includes(job.status)) { trace('info', 'job.process.skip', { jobId: id, reason: job ? `status_${job.status}` : 'not_found' }); return; }
      trace('info', 'job.process.start', { jobId: id, kind: job.memory_kind, sourceId: job.source_id, retryCount: job.retry_count });
      await db.updateTable('memory_capture_jobs').set({ status: 'summarizing', updated_at: now() }).where('id', '=', id).execute();
      const payload = JSON.parse(job.payload_json) as ExecutionMemoryPayload;
      const bootstrap = await agentMemoryOrchestrator.getBootstrap();
      if (!bootstrap.enabled) {
        await db.updateTable('memory_capture_jobs').set({ status: 'skipped', skip_reason: 'agent_memory_disabled', completed_at: now(), updated_at: now() }).where('id', '=', id).execute();
        trace('info', 'job.skipped', { jobId: id, kind: job.memory_kind, reason: 'agent_memory_disabled' });
        return;
      }
      if (job.memory_kind === 'conversation_memory') {
        await agentMemoryOrchestrator.addMemories(
          [{ role: 'user', content: String(payload.userMessage) }, { role: 'assistant', content: String(payload.assistantMessage) }],
          {
            userId: bootstrap.userId,
            runId: job.source_id,
            infer: true,
            metadata: { source: 'sto-claw-chat', sourceAgentId: job.agent_id || undefined, memoryScope: 'preference', sessionKey: job.session_key || undefined }
          });
      } else {
        const injected = payload._executionMemory?.injected ?? [];
        const summaryInput: Record<string, unknown> = { userTask: payload.userMessage, finalAnswerSummary: payload.assistantMessage, tools: payload.tools, agentId: job.agent_id || undefined, engineType: job.engine_type || undefined };
        if (injected.length > 0) summaryInput.injectedExperiences = injected;
        const exp = await agentMemoryOrchestrator.summarizeExecutionExperience(summaryInput);
        exp.candidateAssessments = normalizeCandidateAssessments(exp.candidateAssessments);
        trace('info', 'execution.summary.completed', {
          jobId: id,
          shouldStore: exp.shouldStore === true,
          assessmentCount: exp.candidateAssessments?.length ?? 0,
          injectedMemoryIds: injected.map((item) => item.memoryId),
          candidateDecisions: (exp.candidateAssessments ?? []).map((item) => ({ memoryId: item.memoryId, decision: item.decision, sameIntent: item.sameIntent, oldPathAttempted: item.oldPathAttempted, oldPathFailed: item.oldPathFailed, newPathSucceeded: item.newPathSucceeded })),
        });
        if (exp.shouldStore !== true) { const reason = String(exp.reason || 'summarizer_rejected'); await db.updateTable('memory_capture_jobs').set({ status: 'skipped', skip_reason: reason, completed_at: now(), updated_at: now() }).where('id', '=', id).execute(); trace('info', 'job.skipped', { jobId: id, kind: job.memory_kind, reason }); return; }
        // 把 directCommand(可直接执行的目标命令)/discoveryPath(探索)/parameterPattern/
        // avoidPath/applicableWhen/constraints 全部序列化进存储文本，使检索注入时未来
        // 查询能直接拿到"下次直接执行什么命令"，而非重走探索老路。
        const text = formatExecutionMemoryText(exp);
        const addResult = await agentMemoryOrchestrator.addMemories(
          [{ role: 'user', content: text }],
          {
            userId: bootstrap.userId,
            runId: job.source_id,
            infer: false,
            metadata: { source: 'sto-claw-execution', sourceAgentId: job.agent_id || undefined, memoryScope: 'execution', memoryType: 'tool_routing_experience', confidence: exp.confidence, status: 'active', sessionKey: job.session_key || undefined }
          });
        const newMemoryId = extractMemoryId(addResult);
        const deleteCandidates = resolveDeleteCandidates(exp, injected, Array.isArray(payload.tools) ? payload.tools : []);
        payload._executionMemory = { ...payload._executionMemory, summary: exp, newMemoryId, deleteCandidates, deletedMemoryIds: payload._executionMemory?.deletedMemoryIds ?? [], cleanupPending: deleteCandidates.length > 0 };
        await db.updateTable('memory_capture_jobs').set({ payload_json: JSON.stringify(payload), memory_id: newMemoryId ?? null, updated_at: now() }).where('id', '=', id).execute();
        trace('info', 'execution.memory.added', { jobId: id, newMemoryId: newMemoryId ?? null, deleteCandidates, candidateCount: deleteCandidates.length });
        for (const memoryId of deleteCandidates) {
          try {
            await agentMemoryOrchestrator.deleteMemory(memoryId);
            payload._executionMemory.deletedMemoryIds = [...new Set([...(payload._executionMemory.deletedMemoryIds ?? []), memoryId])];
            await db.updateTable('memory_capture_jobs').set({ payload_json: JSON.stringify(payload), updated_at: now() }).where('id', '=', id).execute();
            trace('info', 'execution.memory.deleted_superseded', { jobId: id, memoryId, newMemoryId: newMemoryId ?? null });
          } catch (error) {
            trace('warn', 'execution.memory.delete_failed', { jobId: id, memoryId, newMemoryId: newMemoryId ?? null, error: String(error).slice(0, 500) });
          }
        }
        const deleted = new Set(payload._executionMemory.deletedMemoryIds ?? []);
        payload._executionMemory.cleanupPending = deleteCandidates.some((memoryId) => !deleted.has(memoryId));
        await db.updateTable('memory_capture_jobs').set({ payload_json: JSON.stringify(payload), updated_at: now() }).where('id', '=', id).execute();
        trace('info', 'execution.memory.lifecycle_applied', { jobId: id, newMemoryId: newMemoryId ?? null, deletedMemoryIds: [...deleted], cleanupPending: payload._executionMemory.cleanupPending });
      }
      await db.updateTable('memory_capture_jobs').set({ status: 'stored', completed_at: now(), updated_at: now() }).where('id', '=', id).execute();
      trace('info', 'job.stored', { jobId: id, kind: job.memory_kind, sourceId: job.source_id });
    } catch (error) { await this.retry(id, error, () => this.process(id)); }
    finally { this.running.delete(id); }
  }

  private async retry(id: string, error: unknown, retry: () => void): Promise<void> {
    const db = getKyselyDatabase();
    const job = await db.selectFrom('memory_capture_jobs').select(['retry_count']).where('id', '=', id).executeTakeFirst();
    const count = (job?.retry_count || 0) + 1;
    const again = count < 3;
    const retryInMs = count * RETRY_BASE_DELAY_MS;
    await db.updateTable('memory_capture_jobs').set({ status: again ? 'retry_wait' : 'failed', retry_count: count, error_message: String(error).slice(0, 500), next_retry_at: again ? new Date(Date.now() + retryInMs).toISOString() : null, completed_at: again ? null : now(), updated_at: now() }).where('id', '=', id).execute();
    trace('warn', again ? 'job.retry_wait' : 'job.failed', { jobId: id, retryCount: count, retryInMs: again ? retryInMs : null, error: String(error).slice(0, 500) });
    if (again) {
      scheduleMemoryCaptureRetry(
        retryInMs,
        async () => {
          await db.updateTable('memory_capture_jobs')
            .set({ status: 'ready', next_retry_at: null, updated_at: now() })
            .where('id', '=', id)
            .where('status', '=', 'retry_wait')
            .execute();
        },
        retry,
        (resumeError) => trace('warn', 'job.retry_resume_failed', {
          jobId: id,
          error: String(resumeError).slice(0, 500),
        }),
      );
    }
  }

  private pruneInjectedMemoryBindings(): void {
    const cutoff = Date.now() - 20 * 60 * 1000;
    for (const [runId, binding] of this.injectedMemoriesByRun) {
      if (binding.createdAt < cutoff) this.injectedMemoriesByRun.delete(runId);
    }
    while (this.injectedMemoriesByRun.size >= 100) {
      const oldest = this.injectedMemoriesByRun.keys().next().value;
      if (!oldest) break;
      this.injectedMemoriesByRun.delete(oldest);
    }
  }
}

function extractMemoryId(result: unknown): string | undefined {
  const visit = (value: unknown): string | undefined => {
    if (Array.isArray(value)) {
      for (const item of value) { const found = visit(item); if (found) return found; }
      return undefined;
    }
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    for (const key of ['id', 'memory_id', 'memoryId']) {
      if (typeof record[key] === 'string' && record[key].trim()) return record[key].trim();
    }
    for (const key of ['results', 'memories', 'data']) { const found = visit(record[key]); if (found) return found; }
    return undefined;
  };
  return visit(result);
}

function normalizeCandidateAssessments(value: unknown): ExecutionExperienceCandidateAssessment[] {
  if (!Array.isArray(value)) return [];
  const decisions = new Set<ExecutionExperienceCandidateAssessment['decision']>(['supersedes', 'still_valid', 'irrelevant_to_run', 'uncertain']);
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    if (typeof record.memoryId !== 'string' || !record.memoryId.trim() || typeof record.decision !== 'string' || !decisions.has(record.decision as ExecutionExperienceCandidateAssessment['decision'])) return [];
    return [{
      memoryId: record.memoryId.trim(),
      decision: record.decision as ExecutionExperienceCandidateAssessment['decision'],
      reason: typeof record.reason === 'string' ? record.reason.slice(0, 500) : undefined,
      sameIntent: record.sameIntent === true,
      oldPathAttempted: record.oldPathAttempted === true,
      oldPathFailed: record.oldPathFailed === true,
      newPathSucceeded: record.newPathSucceeded === true,
    }];
  });
}

function resolveDeleteCandidates(exp: ExecutionExperienceSummary, injected: InjectedExecutionMemory[], tools: unknown[]): string[] {
  const injectedById = new Map(injected.map((item) => [item.memoryId, item]));
  const hasSuccess = tools.some((tool) => tool && typeof tool === 'object' && (tool as Record<string, unknown>).status === 'completed');
  const candidates: string[] = [];
  for (const assessment of exp.candidateAssessments ?? []) {
    const old = injectedById.get(assessment.memoryId);
    if (!old || assessment.decision !== 'supersedes' || assessment.sameIntent !== true || assessment.oldPathAttempted !== true || assessment.oldPathFailed !== true || assessment.newPathSucceeded !== true || !hasSuccess) continue;
    const directCommands = extractDirectExecutionCommands(old.memory);
    const oldPathFailed = tools.some((tool) => {
      if (!tool || typeof tool !== 'object') return false;
      const record = tool as Record<string, unknown>;
      const failedCommand = typeof record.command === 'string' ? record.command : '';
      return record.status === 'error' && directCommands.some((command) => failedCommand === command || failedCommand.startsWith(`${command} `));
    });
    if (oldPathFailed) candidates.push(old.memoryId);
  }
  return [...new Set(candidates)];
}

export const memoryCaptureService = new MemoryCaptureService();
export type { RefreshInput as MemoryCaptureInput };
