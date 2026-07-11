import { randomUUID } from 'node:crypto';
import type { GatewayManager } from '../gateway/manager';
import { getKyselyDatabase } from '../db';
import { agentMemoryOrchestrator } from './agent-memory-orchestrator';
import { logger } from '../utils/logger';

type RefreshInput = { runId?: string | null; sessionKey?: string | null; agentId?: string | null; engineType?: string | null };
type ConversationInput = RefreshInput & { userMessage: string; assistantMessage: string };
type Tool = { toolCallId?: string; name: string; status: 'completed' | 'error'; summary?: string };
const now = () => new Date().toISOString();
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
    trace('info', 'execution.refresh.requested', { jobId: id, runId: sourceId, sessionKey, agentId: input.agentId ?? null, engineType: input.engineType ?? null });
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const result = await gateway.rpc<Record<string, unknown>>('chat.history', { sessionKey, limit: 200 });
      const messages = Array.isArray(result.messages) ? result.messages as Record<string, unknown>[] : [];
      const snapshot = this.latestTurn(messages);
      if (!snapshot || snapshot.tools.length === 0) throw new Error('execution_history_not_ready');
      trace('info', 'execution.history.ready', { jobId: id, runId: sourceId, messageCount: messages.length, toolCount: snapshot.tools.length, userLength: snapshot.userMessage.length, assistantLength: snapshot.assistantMessage.length });
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
        await agentMemoryOrchestrator.addMemories([{ role: 'user', content: String(payload.userMessage) }, { role: 'assistant', content: String(payload.assistantMessage) }], { userId: bootstrap.userId, agentId: job.agent_id || undefined, runId: job.source_id, infer: true, metadata: { source: 'sto-claw-chat', sessionKey: job.session_key || undefined } });
      } else {
        const exp = await agentMemoryOrchestrator.summarizeExecutionExperience({ userTask: payload.userMessage, finalAnswerSummary: payload.assistantMessage, tools: payload.tools, agentId: job.agent_id || undefined, engineType: job.engine_type || undefined });
        if (exp.shouldStore !== true) { const reason = String(exp.reason || 'summarizer_rejected'); await db.updateTable('memory_capture_jobs').set({ status: 'skipped', skip_reason: reason, completed_at: now(), updated_at: now() }).where('id', '=', id).execute(); trace('info', 'job.skipped', { jobId: id, kind: job.memory_kind, reason }); return; }
        const text = `执行经验：${String(exp.intent || exp.taskSignature || '可复用工具执行路径')}\n约束：涉及数据、报表、状态时必须重新调用工具查询。`;
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

  private latestTurn(messages: Record<string, unknown>[]): { userMessage: string; assistantMessage: string; tools: Tool[] } | null {
    const text = (m: Record<string, unknown>) => typeof m.content === 'string' ? m.content.trim() : Array.isArray(m.content) ? m.content.map((b) => b && typeof b === 'object' && typeof (b as Record<string, unknown>).text === 'string' ? (b as Record<string, unknown>).text : '').join('\n').trim() : '';
    let ai = messages.length - 1; while (ai >= 0 && (String(messages[ai].role).toLowerCase() !== 'assistant' || !text(messages[ai]))) ai--; if (ai < 0) return null;
    let ui = ai - 1; while (ui >= 0 && (String(messages[ui].role).toLowerCase() !== 'user' || !text(messages[ui]))) ui--; if (ui < 0) return null;
    const byId = new Map<string, Tool>(); let serial = 0;
    for (const message of messages.slice(ui + 1, ai + 1)) { const blocks = Array.isArray(message.content) ? message.content : []; for (const block of blocks) { if (!block || typeof block !== 'object') continue; const r = block as Record<string, unknown>; if (!['tool_use','tool-call','tool_call'].includes(String(r.type))) continue; const key = String(r.id || `unknown-${serial++}`); byId.set(key, { toolCallId: typeof r.id === 'string' ? r.id : undefined, name: String(r.name || r.toolName || 'unknown_tool'), status: 'completed' }); } if (['tool','toolresult','tool_result'].includes(String(message.role).toLowerCase())) { const key = String(message.toolCallId || `unknown-${serial++}`); const previous = byId.get(key); byId.set(key, { toolCallId: typeof message.toolCallId === 'string' ? message.toolCallId : undefined, name: String(message.toolName || message.name || previous?.name || 'unknown_tool'), status: message.isError === true ? 'error' : 'completed', summary: text(message).slice(0, 300) }); } }
    return { userMessage: text(messages[ui]), assistantMessage: text(messages[ai]), tools: [...byId.values()] };
  }
}

export const memoryCaptureService = new MemoryCaptureService();
export type { RefreshInput as MemoryHistoryRefreshInput, ConversationInput as ConversationMemoryInput };
