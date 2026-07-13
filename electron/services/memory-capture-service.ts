import { randomUUID } from 'node:crypto';
import type { GatewayManager } from '../gateway/manager';
import { getKyselyDatabase } from '../db';
import { agentMemoryOrchestrator } from './agent-memory-orchestrator';
import { logger } from '../utils/logger';
import { getAdapterForSession } from '../engines/manager';
import type { AgentEngineType } from '../engines/types';
import { parseExecutionTurnFromHistory } from '../engines/execution-snapshot';
import { extractDirectExecutionCommands, formatExecutionMemoryText, type ExecutionExperienceCandidateAssessment, type ExecutionExperienceSummary } from './claude-execution-summary-service';

type RefreshInput = { runId?: string | null; sessionKey?: string | null; agentId?: string | null; engineType?: string | null };
type ConversationInput = RefreshInput & { userMessage: string; assistantMessage: string };
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

  async enqueueConversation(input: ConversationInput): Promise<void> {
    const user = input.userMessage.trim(); const assistant = input.assistantMessage.trim();
    if (!user || !assistant || `${user}${assistant}`.length < 12) {
      trace('info', 'conversation.skip', { reason: 'empty_or_too_short', sessionKey: input.sessionKey ?? null, runId: input.runId ?? null, userLength: user.length, assistantLength: assistant.length });
      return;
    }
    const sourceId = input.runId?.trim() || `${input.sessionKey || 'session'}:${randomUUID()}`;
    await this.insert('conversation_memory', sourceId, input, { userMessage: user, assistantMessage: assistant });
    trace('info', 'conversation.enqueued', { jobId: `conversation_memory:${sourceId}`, sourceId, sessionKey: input.sessionKey ?? null, agentId: input.agentId ?? null, userLength: user.length, assistantLength: assistant.length });
    void this.process(`conversation_memory:${sourceId}`);
  }

  async refreshExecutionHistory(input: RefreshInput, gateway: GatewayManager): Promise<void> {
    const sourceId = input.runId?.trim(); const sessionKey = input.sessionKey?.trim();
    if (!sourceId || !sessionKey) {
      trace('warn', 'execution.refresh.skip', { reason: 'missing_run_or_session', runId: input.runId ?? null, sessionKey: input.sessionKey ?? null });
      return;
    }
    const id = `execution_experience:${sourceId}`;
    await this.insert('execution_experience', sourceId, input, { sessionKey });
    // 幂等守卫：若该 run 已处终态（stored/skipped/failed）或正在 summarize，
    // 不再重复 fetch+retry。避免并发/重复派发经 retry() 把 retry_count 推高
    // （retry_count 为非原子读-改-写，并发会双双 +1 并各自 schedule setTimeout）。
    // 注：retry_wait/ready/pending 不拦，以便 setTimeout 自重试与 process 继续推进。
    const existing = await getKyselyDatabase().selectFrom('memory_capture_jobs').select(['status']).where('id', '=', id).executeTakeFirst();
    if (existing && ['stored', 'skipped', 'failed', 'summarizing'].includes(existing.status)) {
      trace('info', 'execution.refresh.skip', { jobId: id, reason: `status_${existing.status}` });
      return;
    }
    trace('info', 'execution.refresh.requested', { jobId: id, runId: sourceId, sessionKey, agentId: input.agentId ?? null, engineType: input.engineType ?? null });
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      // 两种引擎历史来源不同：OpenClaw 走 gateway rpc、Claude 走 transcript 文件。
      // 必须经 adapter 分流并透传 engineType，否则对 Claude 会话会从 OpenClaw 来源
      // 取到空历史，导致 parseExecutionTurn 拿不到、永远 execution_history_not_ready。
      const preferredEngineType: AgentEngineType | undefined = input.engineType === 'claude' ? 'claude' : input.engineType === 'openclaw' ? 'openclaw' : undefined;
      const adapter = await getAdapterForSession(sessionKey, preferredEngineType);
      const historyResult = await adapter.getHistory({ gatewayManager: gateway }, { sessionKey, limit: 200 });
      // 解析（Anthropic 内容块 / OpenAI tool_calls 双格式）已抽到 execution-snapshot 纯函数，
      // 本服务不再感知引擎格式差异。
      const snapshot = parseExecutionTurnFromHistory(historyResult.success ? historyResult.result : undefined);
      // 区分两种 not_ready 场景：
      //  - snapshot 为空：历史尚未就绪（transient，retry 直至 500ms 后历史成熟）。
      //  - snapshot 有但 tools.length===0：该回合无工具调用，无执行经验可沉淀
      //    （permanent，直接 skip，不能 retry——否则纯文本问答会永远 not_ready）。
      if (!snapshot) throw new Error('execution_history_not_ready');
      if (snapshot.tools.length === 0) {
        const reason = 'no_tools_in_turn';
        await getKyselyDatabase().updateTable('memory_capture_jobs').set({ status: 'skipped', skip_reason: reason, completed_at: now(), updated_at: now() }).where('id', '=', id).execute();
        trace('info', 'job.skipped', { jobId: id, kind: 'execution_experience', reason, messageCount: snapshot.messageCount });
        return;
      }
      // 门控 C：工具调用过少（≤3）的回合不值得触发昂贵的 summarize。阈值 >3 才沉淀。
      if (snapshot.tools.length <= 4) {
        const reason = 'too_few_tools';
        await getKyselyDatabase().updateTable('memory_capture_jobs').set({ status: 'skipped', skip_reason: reason, completed_at: now(), updated_at: now() }).where('id', '=', id).execute();
        trace('info', 'job.skipped', { jobId: id, kind: 'execution_experience', reason, toolCount: snapshot.tools.length, messageCount: snapshot.messageCount });
        return;
      }
      trace('info', 'execution.history.ready', { jobId: id, runId: sourceId, messageCount: snapshot.messageCount, toolCount: snapshot.tools.length, userLength: snapshot.userMessage.length, assistantLength: snapshot.assistantMessage.length });
      this.pruneInjectedMemoryBindings();
      const injected = this.injectedMemoriesByRun.get(sourceId)?.memories ?? [];
      this.injectedMemoriesByRun.delete(sourceId);
      const payload: ExecutionMemoryPayload = { ...snapshot, _executionMemory: { injected } };
      trace('info', 'execution.history.context_merged', { jobId: id, runId: sourceId, injectedMemoryIds: injected.map((item) => item.memoryId), count: injected.length });
      await getKyselyDatabase().updateTable('memory_capture_jobs').set({ payload_json: JSON.stringify(payload), status: 'ready', updated_at: now() }).where('id', '=', id).execute();
      void this.process(id);
    } catch (error) { await this.retry(id, error, () => this.refreshExecutionHistory(input, gateway)); }
  }

  async recover(gateway: GatewayManager): Promise<void> {
    const db = getKyselyDatabase();
    const jobs = await db.selectFrom('memory_capture_jobs').selectAll().where('status', 'in', ['pending', 'ready', 'summarizing', 'retry_wait']).execute();
    trace('info', 'recovery.scan', { count: jobs.length });
    for (const job of jobs) {
      if (job.memory_kind === 'execution_experience' && (job.status === 'pending' || job.status === 'retry_wait')) {
        void this.refreshExecutionHistory({ runId: job.source_id, sessionKey: job.session_key, agentId: job.agent_id, engineType: job.engine_type }, gateway);
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

  private async insert(kind: 'conversation_memory' | 'execution_experience', sourceId: string, input: RefreshInput, payload: unknown): Promise<void> {
    const timestamp = now();
    const id = `${kind}:${sourceId}`;
    const result = await getKyselyDatabase().insertInto('memory_capture_jobs').values({ id, source_id: sourceId, memory_kind: kind, status: kind === 'conversation_memory' ? 'ready' : 'pending', payload_json: JSON.stringify(payload), session_key: input.sessionKey || null, agent_id: input.agentId || null, engine_type: input.engineType || null, memory_id: null, skip_reason: null, error_message: null, retry_count: 0, next_retry_at: null, created_at: timestamp, updated_at: timestamp, completed_at: null }).onConflict((oc) => oc.column('id').doNothing()).executeTakeFirst();
    trace('info', 'job.insert', { jobId: id, kind, sourceId, inserted: Number(result.numInsertedOrUpdatedRows ?? 0n) > 0 });
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
            agentId: job.agent_id || undefined,
            runId: job.source_id,
            infer: true,
            metadata: { source: 'sto-claw-chat', memoryScope: 'preference', sessionKey: job.session_key || undefined }
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
            agentId: job.agent_id || undefined,
            runId: job.source_id,
            infer: false,
            metadata: { source: 'sto-claw-execution', memoryScope: 'execution', memoryType: 'tool_routing_experience', confidence: exp.confidence, status: 'active', sessionKey: job.session_key || undefined }
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
    const db = getKyselyDatabase(); const job = await db.selectFrom('memory_capture_jobs').select(['retry_count']).where('id', '=', id).executeTakeFirst(); const count = (job?.retry_count || 0) + 1; const again = count < 3;
    await db.updateTable('memory_capture_jobs').set({ status: again ? 'retry_wait' : 'failed', retry_count: count, error_message: String(error).slice(0, 500), next_retry_at: again ? new Date(Date.now() + count * 30000).toISOString() : null, completed_at: again ? null : now(), updated_at: now() }).where('id', '=', id).execute();
    trace(again ? 'warn' : 'warn', again ? 'job.retry_wait' : 'job.failed', { jobId: id, retryCount: count, retryInMs: again ? count * 30000 : null, error: String(error).slice(0, 500) });
    if (again) { const timer = setTimeout(retry, count * 30000); timer.unref?.(); }
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
      return record.status === 'error' && typeof record.command === 'string' && directCommands.some((command) => record.command === command || record.command.startsWith(`${command} `));
    });
    if (oldPathFailed) candidates.push(old.memoryId);
  }
  return [...new Set(candidates)];
}

export const memoryCaptureService = new MemoryCaptureService();
export type { RefreshInput as MemoryHistoryRefreshInput, ConversationInput as ConversationMemoryInput };
