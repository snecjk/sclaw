/**
 * agent-retry — attempt 循环（镜像云端 cloud_executor + spec §11.1）。
 *
 * 每次 attempt：配额门（/api/token-quota/check）→ invokeAgent（agent-runner）→
 * 输出规整 + JSON Schema 校验 → 失败（引擎失败 / 校验失败 / 卡死超时）退避重试；
 * maxAttempts 耗尽 → failed。事件 agent.attempt.{}、completion.{}、agent.usage 落库。
 *
 * retry-context prompt：第 2+ 次 attempt 把 lastError 喂回 prompt，提示"重做前先检查副作用"。
 */
import type { RunCtx, AgentRunSpec, AgentNodeResult } from './types';
import { normalizeAgentResultOutput, validateOutputAgainstSchema, extractJsonFromText } from './agent-output';
import { buildPrompt } from './prompt-builder';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const backoff = (a: number) => Math.min(30_000, 1000 * 2 ** (a - 1));

/** invokeAgent 由引擎注入（绑好 sdk + env + 卡死保护）；agent-retry 不直接依赖 agent-runner 的 InvokeArgs。 */
export type InvokeAgentFn = (args: { ctx: RunCtx; prompt: string; nodeId: string }) =>
  Promise<{ status: 'succeeded' | 'failed'; rawText: string; output?: any; usage?: any; error?: string }>;

export interface RetryDeps {
  invokeAgent: InvokeAgentFn;  // required：引擎绑 sdk 注入；测试注入 mock
  quota?: () => Promise<boolean>;  // 生产注入：调 /api/token-quota/check，超额度返 false
}

export async function runAgentNodeWithRetry(
  ctx: RunCtx,
  node: any,
  spec: AgentRunSpec,
  deps: RetryDeps,
): Promise<AgentNodeResult> {
  const invokeAgent = deps.invokeAgent;
  const quota = deps.quota ?? (async () => true);
  const contract = spec.completionContract ?? { outputJsonSchema: { type: 'object' }, maxAttempts: 2, onIncomplete: 'retry' as const };
  const maxAttempts = Math.max(contract.maxAttempts ?? 2, 1);
  let lastError = '';
  let lastOutput: any = null;
  let lastRaw = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // G1: 配额门（复用聊天日额度门），超额度 → run FAILED
    if (!(await quota())) {
      await ctx.emit('run.quota_exceeded', { attempt }, node.id);
      await ctx.repo.enqueueOutbox(ctx.runId, 'run', ctx.runId, { run_id: ctx.runId, status: 'FAILED', error: 'daily token quota exceeded' }, 'terminal');
      return { status: 'failed', error: 'daily token quota exceeded' };
    }

    await ctx.repo.incrementNodeAttempt(ctx.runId, node.id);
    await ctx.emit('agent.attempt.start', { attempt }, node.id);

    // retry-context prompt：第 2+ 次把 lastError 喂回
    const prompt = buildPrompt(spec, { runId: ctx.runId, nodeId: node.id, retryReason: attempt > 1 ? lastError : undefined });

    let result: { status: 'succeeded' | 'failed'; rawText: string; output?: any; usage?: any; error?: string };
    try {
      result = await invokeAgent({ ctx, prompt, nodeId: node.id });
    } catch (e: any) {
      // invokeAgent 内部已有双层卡死保护，此处兜底
      result = { status: 'failed', error: '节点执行超时(疑似卡死)', rawText: '' };
    }

    // G1: 记 token 用量（从 SDK ResultMessage.usage 取）
    if (result.usage) {
      await ctx.emit('agent.usage', result.usage, node.id);
    }

    // 输出规整：output 为空时从 rawText 抽 JSON
    const normalized = normalizeAgentResultOutput(
      result.output ?? extractJsonFromText(result.rawText),
      contract, node.type, { rawText: result.rawText });

    if (result.status === 'failed') {
      lastError = result.error ?? 'Agent execution failed.';
      await ctx.emit('agent.attempt.failed', { attempt, error: lastError }, node.id);
      await sleep(backoff(attempt));
      continue;
    }

    const v = validateOutputAgainstSchema(contract.outputJsonSchema, normalized);
    if (v.ok) {
      await ctx.emit('agent.attempt.succeeded', { attempt }, node.id);
      return { status: 'succeeded', output: normalized, rawText: result.rawText, usage: result.usage };
    }

    // 校验失败 → 记 last_completion_issue + 重试
    lastError = v.reason ?? 'Agent output validation failed.';
    lastOutput = normalized;
    lastRaw = result.rawText ?? '';
    await ctx.repo.upsertNodeRun({ run_id: ctx.runId, node_id: node.id, last_completion_issue: lastError, prompt_text: prompt });
    await ctx.emit('completion.retry_scheduled', { attempt, reason: lastError }, node.id);
    if ((contract.onIncomplete ?? 'retry') === 'manual_review') break;
    await sleep(backoff(attempt));
  }

  await ctx.emit('completion.failed', { reason: lastError }, node.id);
  return { status: 'failed', output: lastOutput, error: lastError, rawText: lastRaw };
}
