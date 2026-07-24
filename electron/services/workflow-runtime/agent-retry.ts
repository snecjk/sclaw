/**
 * agent-retry — attempt 循环（spec §11.1）。
 *
 * 每次 attempt：配额门（/api/token-quota/check）→ invokeAgent（agent-runner-claude / agent-runner-openclaw）→
 * 输出规整 + JSON Schema 校验 → 失败（引擎失败 / 校验失败 / 卡死超时）退避重试；
 * maxAttempts 耗尽 → failed。事件 agent.attempt.{}、completion.{}、agent.usage 落库。
 *
 * retry-context prompt：第 2+ 次 attempt 把 lastError 喂回 prompt，提示"重做前先检查副作用"。
 */
import type { RunCtx, AgentRunSpec, AgentNodeResult } from './types';
import { validateOutputAgainstSchema } from './agent-output';
import { buildWorkflowNodePrompt } from './prompt-builder';
import {
  createFailurePacket,
  getWorkflowPacketFailureMessage,
  isRetryableWorkflowPacketFailure,
  validateWorkflowPacket,
  workflowPacketJsonSchema,
} from './workflow-packet';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const backoff = (a: number) => Math.min(30_000, 1000 * 2 ** (a - 1));

export interface AgentStreamEvent {
  type: string;
  message?: string;
  rawText?: string;
  toolId?: string;
  toolName?: string;
  callId?: string;
  isError?: boolean;
}

/** invokeAgent 由引擎注入（绑好 sdk + env + 卡死保护）；agent-retry 不直接依赖具体运行器的 InvokeArgs。 */
export type InvokeAgentFn = (args: {
  ctx: RunCtx;
  prompt: string;
  nodeId: string;
  /** Attempt-scoped identity used by transient workflow engines. */
  attempt?: number;
  noProgressMs?: number;
  deadlineMs?: number;
  onStreamEvent?: (event: AgentStreamEvent) => void | Promise<void>;
  allowedTools?: string[];
  allowedSkills?: string[];
  permissionMode?: string;
  model?: string;
  outputSchema?: Record<string, unknown>;
}) =>
  Promise<{ status: 'succeeded' | 'failed'; rawText: string; output?: any; usage?: any; error?: string }>;

export interface RetryDeps {
  invokeAgent: InvokeAgentFn;  // required：引擎绑 sdk 注入；测试注入 mock
  quota?: () => Promise<boolean>;  // 生产注入：调 /api/token-quota/check，超额度返 false
}

/**
 * 尝试循环调用Agent：配额门 + invokeAgent + 输出规整 + JSON Schema 校验。
 * @param ctx  运行时上下文
 * @param node  节点
 * @param spec  节点规格
 * @param deps  依赖
 * @returns {status: 'succeeded' | 'failed', output?: any, error?: string, rawText?: string, usage?: any}
 *
 */
export async function runAgentNodeWithRetry(
  ctx: RunCtx,
  node: any,
  spec: AgentRunSpec,
  deps: RetryDeps,
): Promise<AgentNodeResult> {
  const invokeAgent = deps.invokeAgent;
  const quota = deps.quota ?? (async () => true);
  const contract = spec.completionContract ?? { outputJsonSchema: { type: 'object' }, maxAttempts: 2, onIncomplete: 'retry' as const };
  // 最大重试次数
  const maxAttempts = Math.max(contract.maxAttempts ?? 2, 1);
  let lastError = '';
  let lastOutput: any = null;
  let lastRaw = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // G1: 配额门（复用聊天日额度门），超额度 → run FAILED
    if (!(await quota())) {
      await ctx.emit('run.quota_exceeded', { attempt }, node.id);
      return { status: 'failed', error: 'daily token quota exceeded' };
    }

    await ctx.repo.incrementNodeAttempt(ctx.runId, node.id);
    await ctx.emit('agent.attempt.start', { attempt }, node.id);

    // The client owns the prompt contract.  Never consume server-compiled prose
    // or recover JSON from the assistant's chat text.
    const prompt = `${buildWorkflowNodePrompt(spec, node, ctx)}${lastError ? `\n\n上次结构化校验失败：${lastError}。请按 schema 重新生成完整结果。` : ''}`;
    // 与服务端智能节点执行口径一致：在实际调用 Agent 前固化本次 prompt。
    // 重试会覆盖为最新一次尝试的 prompt，便于排查最终生效的上下文。
    await ctx.repo.upsertNodeRun({
      run_id: ctx.runId,
      node_id: node.id,
      node_type: node.type,
      status: 'RUNNING',
      prompt_text: prompt,
    });
    const promptNode = await ctx.repo.getNodeRun(ctx.runId, node.id);
    await ctx.repo.enqueueOutbox(ctx.runId, 'node_run', `${ctx.runId}:${node.id}`, {
      run_id: ctx.runId,
      node_id: node.id,
      node_type: node.type,
      status: 'RUNNING',
      input_json: promptNode?.input_json,
      output_json: promptNode?.output_json,
      attempt_count: promptNode?.attempt_count ?? attempt,
      prompt_text: prompt,
      last_completion_issue: promptNode?.last_completion_issue,
      started_at: promptNode?.started_at,
      completed_at: promptNode?.completed_at,
    }, 'progress');

    let result: { status: 'succeeded' | 'failed'; rawText: string; output?: any; usage?: any; error?: string };
    try {
      // 调用Agent
      let toolCalls = 0;
      result = await invokeAgent({
        ctx,
        prompt,
        nodeId: node.id,
        attempt,
        noProgressMs: spec.guardrails?.timeoutMs,
        deadlineMs: spec.guardrails?.timeoutMs ? Math.max(spec.guardrails.timeoutMs * 2, spec.guardrails.timeoutMs + 60_000) : undefined,
        allowedTools: spec.allowedTools,
        allowedSkills: spec.allowedSkills,
      permissionMode: spec.permissionPolicy?.mode,
      model: spec.target.model,
      outputSchema: workflowPacketJsonSchema(contract.dataJsonSchema ?? node.config?.outputContract?.schema, {
        runId: ctx.runId, nodeId: node.id, nodeType: node.type, allowedPorts: Array.isArray(node.config?.branches) ? node.config.branches.map((branch: any) => branch?.branchKey ?? branch?.key).filter(Boolean) : undefined,
        requireSelectedPort: node.type === 'agent_condition',
      }),
        onStreamEvent: async (event) => {
          if (event.type === 'agent.tool_start') toolCalls += 1;
          await ctx.emit(event.type, event, node.id);
        },
      });
      // A workflow already has deadline, retry and output-contract guards.
      // Do not impose a hidden 20-call ceiling: file-heavy or investigative
      // nodes legitimately need more tool rounds.  A DSL may still opt in to
      // an explicit positive limit for cost/control reasons.
      const configuredToolCallLimit = spec.limits?.maxToolCalls;
      if (typeof configuredToolCallLimit === 'number'
        && Number.isFinite(configuredToolCallLimit)
        && configuredToolCallLimit > 0
        && toolCalls > configuredToolCallLimit) {
        result = { status: 'failed', rawText: result.rawText, usage: result.usage, error: `工具调用次数超过显式配置限制 ${configuredToolCallLimit}` };
      }
    } catch (e: any) {
      // invokeAgent 内部已有双层卡死保护；这里保留真实异常，避免把 SDK/环境错误误报成超时。
      result = { status: 'failed', error: e instanceof Error ? e.message : String(e), rawText: '' };
    }

    // G1: 记 token 用量（从 SDK ResultMessage.usage 取）
    if (result.usage) {
      await ctx.emit('agent.usage', result.usage, node.id);
    }

    if (result.status === 'failed') {
      lastError = result.error ?? 'Agent execution failed.';
      await ctx.emit('agent.attempt.failed', { attempt, error: lastError }, node.id);
      await sleep(backoff(attempt));
      continue;
    }

    const packet = result.output;
    if (!packet) {
      lastError = '模型未返回 SDK 结构化结果';
      lastOutput = createFailurePacket({ runId: ctx.runId, nodeId: node.id, nodeType: node.type, attempt, code: 'RESULT_STRUCTURED_OUTPUT_MISSING', category: 'output_validation', message: lastError, retryable: attempt < maxAttempts });
      lastRaw = result.rawText ?? '';
      await ctx.emit('completion.retry_scheduled', { attempt, reason: lastError, code: 'RESULT_STRUCTURED_OUTPUT_MISSING' }, node.id);
      await sleep(backoff(attempt));
      continue;
    }
    const ports = Array.isArray(node.config?.branches)
      ? node.config.branches.map((branch: any) => branch?.branchKey ?? branch?.key).filter(Boolean)
      : undefined;
    const packetValidation = validateWorkflowPacket(packet, {
      runId: ctx.runId, nodeId: node.id, nodeType: node.type, allowedPorts: ports,
      requireSelectedPort: node.type === 'agent_condition',
    });
    if (packetValidation.ok && packetValidation.outcome === 'failed') {
      lastOutput = packetValidation.packet;
      lastRaw = result.rawText ?? '';
      lastError = getWorkflowPacketFailureMessage(packetValidation.packet) ?? 'Agent 返回了未说明原因的失败包';
      const retryable = isRetryableWorkflowPacketFailure(packetValidation.packet);
      await ctx.emit('agent.attempt.failed', { attempt, error: lastError, retryable, source: 'agent_packet' }, node.id);
      if (!retryable) {
        await ctx.emit('completion.failed', { reason: lastError, source: 'agent_packet' }, node.id);
        return { status: 'failed', output: lastOutput, error: lastError, rawText: lastRaw, usage: result.usage };
      }
      if (attempt < maxAttempts) {
        await ctx.emit('completion.retry_scheduled', { attempt, reason: lastError, source: 'agent_packet' }, node.id);
        await sleep(backoff(attempt));
      }
      continue;
    }
    const v = packetValidation.ok
      ? validateOutputAgainstSchema(contract.dataJsonSchema ?? node.config?.outputContract?.schema ?? { type: 'object' }, packetValidation.packet.payload)
      : { ok: false, reason: packetValidation.message };
    if (v.ok && packetValidation.ok) {
      await ctx.repo.upsertNodeRun({
        run_id: ctx.runId, node_id: node.id, node_type: node.type,
        status: 'RUNNING', prompt_text: prompt, last_completion_issue: null,
      });
      await ctx.emit('agent.attempt.succeeded', { attempt }, node.id);
      return { status: 'succeeded', output: packetValidation.packet, rawText: result.rawText, usage: result.usage };
    }

    // 校验失败 → 记 last_completion_issue + 重试
    lastError = v.reason ?? 'Agent output validation failed.';
    lastOutput = createFailurePacket({
      runId: ctx.runId, nodeId: node.id, nodeType: node.type, attempt,
      code: packetValidation.ok ? 'RESULT_SCHEMA_INVALID' : packetValidation.code,
      category: 'output_validation', message: lastError, retryable: attempt < maxAttempts,
    });
    lastRaw = result.rawText ?? '';
    await ctx.repo.upsertNodeRun({
      run_id: ctx.runId,
      node_id: node.id,
      node_type: node.type,
      status: 'RUNNING',
      last_completion_issue: lastError,
      prompt_text: prompt,
    });
    await ctx.emit('completion.retry_scheduled', { attempt, reason: lastError }, node.id);
    if ((contract.onIncomplete ?? 'retry') === 'manual_review') {
      await ctx.emit('completion.manual_review', { attempt, reason: lastError }, node.id);
      return { status: 'manual_review', output: lastOutput, error: lastError, rawText: lastRaw };
    }
    await sleep(backoff(attempt));
  }

  await ctx.emit('completion.failed', { reason: lastError }, node.id);
  return { status: 'failed', output: lastOutput, error: lastError, rawText: lastRaw };
}
