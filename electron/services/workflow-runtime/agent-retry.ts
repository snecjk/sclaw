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
  claudeStructuredOutputEnvelopeJsonSchema,
  getWorkflowPacketFailureMessage,
  isRetryableWorkflowPacketFailure,
  normalizeStructuredOutputPacket,
  normalizeWorkflowArtifactDrafts,
  unwrapClaudeStructuredOutputEnvelope,
  validateWorkflowPacket,
  workflowPacketJsonSchema,
} from './workflow-packet';
import { deriveWorkflowNodeSessionId } from './node-session';
import { canonicalizeWorkflowArtifacts, validateInlinePayload } from './artifact-output';
import { workflowExecLog } from './logging';
import {
  resolveWorkflowAgentDeadlineMs,
  resolveWorkflowAgentNoProgressMs,
} from '../../../shared/workflow-agent-timeouts';

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

/** A safe, actionable description of the last failed tool/MCP call.
 * It is persisted in the node's existing completion-issue field and added to
 * the next attempt prompt, so retries react to the actual failure instead of
 * a generic wrapper emitted by the agent runtime. */
export interface RetryFailureContext {
  source: 'tool' | 'mcp' | 'agent';
  toolName?: string;
  toolId?: string;
  callId?: string;
  error: string;
}

const RETRY_ERROR_LIMIT = 1_500;
const PACKET_OUTPUT_MISSING = '完整 WorkflowPacket 输出缺失';

export function summarizeRetryFailure(value: unknown): string {
  const text = typeof value === 'string' ? value : String(value ?? 'Unknown tool failure');
  return text
    // Credentials must not enter SQLite, sync payloads, or a retry prompt.
    .replace(/\b(authorization|token|api[_-]?key|password|secret)\s*[:=]\s*[^\s,;]+/gi, '$1: [REDACTED]')
    // Local absolute paths can reveal user names and workstation layout.
    .replace(/[A-Za-z]:\\[^\s"']+|\/(?:Users|home)\/[^\s"']+/g, '[LOCAL_PATH]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, RETRY_ERROR_LIMIT);
}

function formatRetryFailure(context: RetryFailureContext): string {
  if (context.source === 'agent') return `模型服务调用失败：${context.error}`;
  const target = context.toolName ?? context.toolId ?? '工具/MCP 调用';
  return `${context.source === 'mcp' ? 'MCP' : '工具'} ${target} 实际失败：${context.error}`;
}

/** invokeAgent 由引擎注入（绑好 sdk + env + 卡死保护）；agent-retry 不直接依赖具体运行器的 InvokeArgs。 */
export type InvokeAgentFn = (args: {
  ctx: RunCtx;
  prompt: string;
  nodeId: string;
  /** Attempt-scoped identity used by transient workflow engines. */
  attempt?: number;
  agentSessionId?: string;
  resumeSession?: boolean;
  noProgressMs?: number;
  deadlineMs?: number;
  onStreamEvent?: (event: AgentStreamEvent) => void | Promise<void>;
  allowedTools?: string[];
  permissionMode?: string;
  model?: string;
  outputSchema?: Record<string, unknown>;
}) =>
  Promise<{ status: 'succeeded' | 'failed'; rawText: string; output?: any; usage?: any; error?: string }>;

export interface RetryDeps {
  invokeAgent: InvokeAgentFn;  // required：引擎绑 sdk 注入；测试注入 mock
  quota?: () => Promise<boolean>;  // 生产注入：调 /api/token-quota/check，超额度返 false
  execEngine?: 'claude' | 'openclaw';
  /** User cancellation terminates this attempt loop instead of scheduling a retry. */
  isCancelled?: () => boolean | Promise<boolean>;
}

function isWorkflowPacketProtocolFailure(context: RetryFailureContext | null, error: string): boolean {
  const detail = `${context?.error ?? ''} ${error}`;
  return /StructuredOutput[\s\S]{0,300}(root|required property)|完整\s*WorkflowPacket|未返回 SDK 结构化结果|WorkflowPacket[\s\S]{0,120}(root|顶层|缺少)/i.test(detail);
}

function protocolRetryInstruction(execEngine?: 'claude' | 'openclaw'): string {
  if (execEngine === 'openclaw') {
    return '上次结果不是完整 WorkflowPacket。不要试探 schema，也不要只输出 payload、包装对象或解释文字；请直接按当前模板输出一个完整的 WorkflowPacket 顶层 JSON。';
  }
  return '上次 StructuredOutput 调用没有提交完整 WorkflowPacket。不要试探 schema，也不要只提交 payload、嵌套 WorkflowPacket 或字符串化 JSON；请一次调用 StructuredOutput，并将当前模板的完整 WorkflowPacket 作为唯一顶层输入。';
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
  let lastFailure: RetryFailureContext | null = null;
  let lastOutput: any = null;
  let lastRaw = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (await deps.isCancelled?.()) {
      return { status: 'cancelled', error: '节点执行已取消' };
    }
    // G1: 配额门（复用聊天日额度门），超额度 → run FAILED
    if (!(await quota())) {
      await ctx.emit('run.quota_exceeded', { attempt }, node.id);
      return { status: 'failed', error: 'daily token quota exceeded' };
    }

    const priorNodeRun = await ctx.repo.getNodeRun(ctx.runId, node.id);
    const agentSessionId = priorNodeRun?.agent_session_id || deriveWorkflowNodeSessionId(ctx.runId, node.id);
    const resumeSession = Boolean(priorNodeRun?.agent_session_id);
    await ctx.repo.incrementNodeAttempt(ctx.runId, node.id);
    await ctx.emit('agent.attempt.start', { attempt }, node.id);

    // The client owns the prompt contract.  Never consume server-compiled prose
    // or recover JSON from the assistant's chat text.
    const retryContext = isWorkflowPacketProtocolFailure(lastFailure, lastError)
      ? `\n\n上次执行失败：${PACKET_OUTPUT_MISSING}。${protocolRetryInstruction(deps.execEngine)}`
      : lastFailure
      ? `\n\n上次执行的实际失败信息：${formatRetryFailure(lastFailure)}。请先针对该错误检查调用参数、前置条件或替代工具，再重新执行；不要重复已完成的副作用。`
      : lastError
        ? `\n\n上次结构化校验失败：${lastError}。请按 schema 重新生成完整结果。`
        : '';
    const prompt = `${buildWorkflowNodePrompt(spec, node, ctx, { execEngine: deps.execEngine, attempt })}${retryContext}`;
    workflowExecLog('debug', 'agent-prompt-metrics', 'workflow node prompt prepared', {
      runId: ctx.runId,
      nodeId: node.id,
      attempt,
      promptBytes: Buffer.byteLength(prompt, 'utf8'),
    });
    // 与服务端智能节点执行口径一致：在实际调用 Agent 前固化本次 prompt。
    // 重试会覆盖为最新一次尝试的 prompt，便于排查最终生效的上下文。
    await ctx.repo.upsertNodeRun({
      run_id: ctx.runId,
      node_id: node.id,
      node_type: node.type,
      status: 'RUNNING',
      agent_session_id: agentSessionId,
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
      const toolNamesByCallId = new Map<string, { toolId?: string; toolName?: string }>();
      const noProgressMs = resolveWorkflowAgentNoProgressMs(spec.guardrails?.timeoutMs);
      result = await invokeAgent({
        ctx,
        prompt,
        nodeId: node.id,
        attempt,
        agentSessionId,
        resumeSession,
        noProgressMs,
        deadlineMs: resolveWorkflowAgentDeadlineMs(),
        allowedTools: spec.allowedTools,
      permissionMode: spec.permissionPolicy?.mode,
      model: spec.target.model,
      outputSchema: deps.execEngine === 'openclaw'
        ? workflowPacketJsonSchema(contract.dataJsonSchema ?? node.config?.outputContract?.schema, {
        runId: ctx.runId, nodeId: node.id, nodeType: node.type, allowedPorts: Array.isArray(node.config?.branches) ? node.config.branches.map((branch: any) => branch?.branchKey ?? branch?.key).filter(Boolean) : undefined,
        requireSelectedPort: node.type === 'agent_condition',
        })
        : claudeStructuredOutputEnvelopeJsonSchema(),
        onStreamEvent: async (event) => {
          if (event.type === 'agent.tool_start') {
            toolCalls += 1;
            if (event.callId) toolNamesByCallId.set(event.callId, { toolId: event.toolId, toolName: event.toolName });
          }
          if (event.type === 'agent.tool_end' && event.isError) {
            const tool = event.callId ? toolNamesByCallId.get(event.callId) : undefined;
            const toolName = tool?.toolName ?? event.toolName;
            lastFailure = {
              source: /mcp/i.test(toolName ?? event.toolId ?? '') ? 'mcp' : 'tool',
              toolId: tool?.toolId ?? event.toolId,
              toolName,
              callId: event.callId,
              error: summarizeRetryFailure(event.message),
            };
            // Persist the same safe summary that goes into the retry prompt;
            // raw tool responses may contain credentials or local paths.
            event = { ...event, message: lastFailure.error };
          }
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

    // cancelAgent resolves an in-flight invocation as a failed result. Check
    // cancellation before normal failure handling can schedule another attempt.
    if (await deps.isCancelled?.()) {
      return { status: 'cancelled', error: '节点执行已取消', rawText: result.rawText };
    }

    // G1: 记 token 用量（从 SDK ResultMessage.usage 取）
    if (result.usage) {
      await ctx.emit('agent.usage', result.usage, node.id);
    }

    if (result.status === 'failed') {
      const resultError = summarizeRetryFailure(result.error ?? 'Agent execution failed.');
      const providerRateLimitExhausted = /模型服务请求过于频繁（HTTP 429），已按间隔重试\s*3\s*次仍失败/i.test(resultError);
      const failedProtocol = !providerRateLimitExhausted && isWorkflowPacketProtocolFailure(lastFailure, resultError);
      const agentError = providerRateLimitExhausted
        ? resultError
        : lastFailure ? formatRetryFailure(lastFailure) : resultError;
      lastError = failedProtocol ? `${PACKET_OUTPUT_MISSING}：${agentError}` : agentError;
      if (failedProtocol) {
        lastFailure = { source: 'agent', error: lastError };
        lastOutput = createFailurePacket({
          runId: ctx.runId, nodeId: node.id, nodeType: node.type, attempt,
          code: 'RESULT_WORKFLOW_PACKET_MISSING', category: 'output_validation', message: lastError, retryable: attempt < maxAttempts,
        });
        lastRaw = result.rawText ?? '';
      } else if (providerRateLimitExhausted) {
        lastFailure = { source: 'agent', error: lastError };
      } else if (!lastFailure) {
        lastFailure = { source: 'agent', error: lastError };
      }
      await ctx.repo.upsertNodeRun({
        run_id: ctx.runId, node_id: node.id, node_type: node.type, status: 'RUNNING',
        last_completion_issue: lastError, prompt_text: prompt,
      });
      const failureMetadata = providerRateLimitExhausted
        ? { code: 'PROVIDER_RATE_LIMIT', category: 'provider', retryable: false }
        : failedProtocol ? { code: 'RESULT_WORKFLOW_PACKET_MISSING', protocol: 'workflow_packet' } : {};
      await ctx.emit('agent.attempt.failed', { attempt, error: lastError, failureContext: lastFailure, ...failureMetadata }, node.id);
      if (providerRateLimitExhausted) {
        await ctx.emit('completion.failed', { reason: lastError, ...failureMetadata }, node.id);
        return { status: 'failed', output: lastOutput, error: lastError, rawText: result.rawText ?? '', usage: result.usage };
      }
      if (attempt < maxAttempts) await ctx.emit('completion.retry_scheduled', { attempt, reason: lastError, failureContext: lastFailure, ...(failedProtocol ? { code: 'RESULT_WORKFLOW_PACKET_MISSING', protocol: 'workflow_packet' } : {}) }, node.id);
      if (attempt < maxAttempts) await sleep(backoff(attempt));
      continue;
    }

    const claudeEnvelope = deps.execEngine === 'openclaw'
      ? { packet: result.output, unwrapped: false }
      : unwrapClaudeStructuredOutputEnvelope(result.output);
    const structuredOutput = normalizeStructuredOutputPacket(claudeEnvelope.packet);
    const artifactDrafts = normalizeWorkflowArtifactDrafts(structuredOutput.packet);
    const packet = artifactDrafts.packet;
    if (!packet) {
      lastError = `${PACKET_OUTPUT_MISSING}：模型未返回 SDK 结构化结果`;
      lastFailure = { source: 'agent', error: lastError };
      lastOutput = createFailurePacket({ runId: ctx.runId, nodeId: node.id, nodeType: node.type, attempt, code: 'RESULT_WORKFLOW_PACKET_MISSING', category: 'output_validation', message: lastError, retryable: attempt < maxAttempts });
      lastRaw = result.rawText ?? '';
      await ctx.emit('completion.retry_scheduled', { attempt, reason: lastError, code: 'RESULT_WORKFLOW_PACKET_MISSING', protocol: 'workflow_packet' }, node.id);
      await sleep(backoff(attempt));
      continue;
    }
    if (structuredOutput.normalized) {
      await ctx.emit('completion.output_normalized', { attempt, reason: 'payload_json_string_normalized' }, node.id);
    }
    if (artifactDrafts.normalized) {
      await ctx.emit('completion.output_normalized', {
        attempt,
        reason: 'artifact_host_metadata_stripped',
        artifacts: artifactDrafts.stripped,
      }, node.id);
      workflowExecLog('info', 'agent-output-normalized', 'host-owned artifact metadata stripped from model draft', {
        runId: ctx.runId,
        nodeId: node.id,
        attempt,
        artifacts: artifactDrafts.stripped,
      });
    }
    const ports = Array.isArray(node.config?.branches)
      ? node.config.branches.map((branch: any) => branch?.branchKey ?? branch?.key).filter(Boolean)
      : undefined;
    const packetValidation = validateWorkflowPacket(packet, {
      runId: ctx.runId, nodeId: node.id, nodeType: node.type, allowedPorts: ports,
      requireSelectedPort: node.type === 'agent_condition',
      artifactMode: 'draft',
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
    const inlineValidation = v.ok && packetValidation.ok
      ? validateInlinePayload(packetValidation.packet.payload)
      : undefined;
    const artifactValidation = v.ok && packetValidation.ok && inlineValidation?.ok
      ? await canonicalizeWorkflowArtifacts(packetValidation.packet, {
        runId: ctx.runId,
        nodeId: node.id,
        workspace: spec.runtimeContext.workspacePath ?? '',
        defaultKind: node.type === 'agent_output' ? 'OUTPUT' : 'INTERMEDIATE',
      })
      : undefined;
    const canonicalValidation = artifactValidation?.ok
      ? validateWorkflowPacket(artifactValidation.value, {
        runId: ctx.runId, nodeId: node.id, nodeType: node.type, allowedPorts: ports,
        requireSelectedPort: node.type === 'agent_condition',
      })
      : undefined;
    if (v.ok && packetValidation.ok && inlineValidation?.ok && artifactValidation?.ok && canonicalValidation?.ok) {
      const canonicalPacket = canonicalValidation.packet;
      const structuredOutputBytes = Buffer.byteLength(JSON.stringify(result.output ?? {}), 'utf8');
      const canonicalPacketBytes = Buffer.byteLength(JSON.stringify(canonicalPacket), 'utf8');
      const artifactBytes = canonicalPacket.artifacts.reduce((sum, artifact) => sum + (artifact.size ?? 0), 0);
      workflowExecLog('info', 'agent-output-metrics', 'workflow node output canonicalized', {
        runId: ctx.runId,
        nodeId: node.id,
        attempt,
        structuredOutputBytes,
        inlinePayloadBytes: inlineValidation.value.bytes,
        artifactCount: canonicalPacket.artifacts.length,
        artifactBytes,
        canonicalPacketBytes,
      });
      await ctx.repo.upsertNodeRun({
        run_id: ctx.runId, node_id: node.id, node_type: node.type,
        status: 'RUNNING', prompt_text: prompt, last_completion_issue: null,
      });
      await ctx.emit('agent.attempt.succeeded', { attempt }, node.id);
      return { status: 'succeeded', output: canonicalPacket, rawText: '', usage: result.usage };
    }

    // 校验失败 → 记 last_completion_issue + 重试
    const validationFailure = !v.ok
      ? { code: packetValidation.ok ? 'RESULT_SCHEMA_INVALID' : packetValidation.code, message: v.reason }
      : inlineValidation && !inlineValidation.ok
        ? inlineValidation
        : artifactValidation && !artifactValidation.ok
          ? artifactValidation
          : canonicalValidation && !canonicalValidation.ok
            ? canonicalValidation
            : { code: 'RESULT_SCHEMA_INVALID', message: 'Agent output validation failed.' };
    lastError = validationFailure.message ?? 'Agent output validation failed.';
    lastOutput = createFailurePacket({
      runId: ctx.runId, nodeId: node.id, nodeType: node.type, attempt,
      code: validationFailure.code,
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
