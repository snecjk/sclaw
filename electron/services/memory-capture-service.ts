import { randomUUID } from 'node:crypto';
import type { GatewayManager } from '../gateway/manager';
import { getKyselyDatabase } from '../db';
import { agentMemoryOrchestrator } from './agent-memory-orchestrator';
import { logger } from '../utils/logger';
import { getAdapterForSession } from '../engines/manager';
import type { AgentEngineType } from '../engines/types';
import { parseExecutionTurnFromHistory } from '../engines/execution-snapshot';
import { formatExecutionMemoryText } from './claude-execution-summary-service';
import { extractActiveExecutionMemories } from '../../shared/execution-memory-filter';

type RefreshInput = { runId?: string | null; sessionKey?: string | null; agentId?: string | null; engineType?: string | null };
type ConversationInput = RefreshInput & { userMessage: string; assistantMessage: string };
const now = () => new Date().toISOString();
// 去重预检相似度阈值：userTask 与既有执行类记忆的向量相似度 >= 此值则视为"模式已沉淀过"，
// 跳过昂贵的 summarize（claw 端只有 agent 接口，每次 ~40s）。STO 后端返回余弦相似度，
// 0.85 取近重复档；可按 execution.dedup 日志里的真实 topScore 校准。
const DEDUP_SIMILARITY_THRESHOLD = 0.85;
type LogFields = Record<string, unknown>;

function trace(level: 'info' | 'warn', event: string, fields: LogFields): void {
  logger[level](`[memory-capture] ${event} ${JSON.stringify(fields)}`);
}

class MemoryCaptureService {
  private running = new Set<string>();

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
      if (snapshot.tools.length <= 3) {
        const reason = 'too_few_tools';
        await getKyselyDatabase().updateTable('memory_capture_jobs').set({ status: 'skipped', skip_reason: reason, completed_at: now(), updated_at: now() }).where('id', '=', id).execute();
        trace('info', 'job.skipped', { jobId: id, kind: 'execution_experience', reason, toolCount: snapshot.tools.length, messageCount: snapshot.messageCount });
        return;
      }
      trace('info', 'execution.history.ready', { jobId: id, runId: sourceId, messageCount: snapshot.messageCount, toolCount: snapshot.tools.length, userLength: snapshot.userMessage.length, assistantLength: snapshot.assistantMessage.length });
      await getKyselyDatabase().updateTable('memory_capture_jobs').set({ payload_json: JSON.stringify(snapshot), status: 'ready', updated_at: now() }).where('id', '=', id).execute();
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
      const payload = JSON.parse(job.payload_json) as Record<string, unknown>;
      const bootstrap = await agentMemoryOrchestrator.getBootstrap();
      if (job.memory_kind === 'conversation_memory') {
        await agentMemoryOrchestrator.addMemories([{ role: 'user', content: String(payload.userMessage) }, { role: 'assistant', content: String(payload.assistantMessage) }], { userId: bootstrap.userId, agentId: job.agent_id || undefined, runId: job.source_id, infer: true, metadata: { source: 'sto-claw-chat', memoryScope: 'preference', sessionKey: job.session_key || undefined } });
      } else {
        // 门控 A：去重预检。用 userTask 走与注入端相同的 mem0 检索路径（searchMemories），
        // 再用共享函数 extractActiveExecutionMemories 按 memoryScope==='execution' 过滤——
        // 不能用 memoryTypes 过滤：execution 记忆的 memory_type 字段并非 'tool_routing_experience'
        //（那只是 metadata 子标签），memoryTypes 会匹配不到。若已有高相似度 active 记忆，
        // 说明该模式已沉淀过，跳过昂贵的 summarize。
        // 注：dedup 是优化型门控，检索失败时 fail-open（降级直接 summarize），不阻断沉淀。
        const userTaskQuery = String(payload.userMessage ?? '').trim();
        if (userTaskQuery) {
          try {
            const memResult = await agentMemoryOrchestrator.searchMemories(userTaskQuery, {
              userId: bootstrap.userId,
              agentId: job.agent_id || undefined,
              topK: 8,
            });
            const existing = extractActiveExecutionMemories(memResult);
            const dup = existing.find((it) => typeof it.score === 'number' && it.score >= DEDUP_SIMILARITY_THRESHOLD);
            const topScore = existing.reduce((m, it) => typeof it.score === 'number' && it.score > m ? it.score : m, 0);
            trace('info', 'execution.dedup', { jobId: id, topScore, threshold: DEDUP_SIMILARITY_THRESHOLD, skip: Boolean(dup) });
            if (dup) {
              const reason = 'pattern_already_captured';
              await db.updateTable('memory_capture_jobs').set({ status: 'skipped', skip_reason: reason, completed_at: now(), updated_at: now() }).where('id', '=', id).execute();
              trace('info', 'job.skipped', { jobId: id, kind: job.memory_kind, reason, topScore: dup.score });
              return;
            }
          } catch (dedupError) {
            trace('warn', 'execution.dedup.error', { jobId: id, error: String(dedupError).slice(0, 200) });
          }
        }
        const exp = await agentMemoryOrchestrator.summarizeExecutionExperience({ userTask: payload.userMessage, finalAnswerSummary: payload.assistantMessage, tools: payload.tools, agentId: job.agent_id || undefined, engineType: job.engine_type || undefined });
        if (exp.shouldStore !== true) { const reason = String(exp.reason || 'summarizer_rejected'); await db.updateTable('memory_capture_jobs').set({ status: 'skipped', skip_reason: reason, completed_at: now(), updated_at: now() }).where('id', '=', id).execute(); trace('info', 'job.skipped', { jobId: id, kind: job.memory_kind, reason }); return; }
        // 把 directCommand(可直接执行的目标命令)/discoveryPath(探索)/parameterPattern/
        // avoidPath/applicableWhen/constraints 全部序列化进存储文本，使检索注入时未来
        // 查询能直接拿到"下次直接执行什么命令"，而非重走探索老路。
        const text = formatExecutionMemoryText(exp);
        await agentMemoryOrchestrator.addMemories([{ role: 'user', content: text }], { userId: bootstrap.userId, agentId: job.agent_id || undefined, runId: job.source_id, infer: false, metadata: { source: 'sto-claw-execution', memoryScope: 'execution', memoryType: 'tool_routing_experience', confidence: exp.confidence, status: 'active', sessionKey: job.session_key || undefined } });
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
}

export const memoryCaptureService = new MemoryCaptureService();
export type { RefreshInput as MemoryHistoryRefreshInput, ConversationInput as ConversationMemoryInput };
