/** Compile the client-local equivalent of memory-center workflow_core/compiler.py. */
import type { AgentRunSpec, RunCtx } from './types';

const SMART_TYPES = new Set(['agent_data_fetch', 'agent_data_process', 'agent_condition', 'agent_output']);

export function compileAgentRunSpec(node: any, ctx: RunCtx): AgentRunSpec {
  const cfg = node?.config ?? {};
  const agentConfig = cfg.agentConfig ?? {};
  const task = { ...(cfg.task ?? agentConfig.task ?? {}) } as Record<string, any>;
  const runtime = { ...(cfg.runtime ?? agentConfig.runtime ?? agentConfig) } as Record<string, any>;
  const guardrails = { ...(cfg.guardrails ?? agentConfig.guardrails ?? {}) } as Record<string, any>;
  const business = cfg.businessConfig ?? {};
  const smartKind = SMART_TYPES.has(node?.type) ? node.type : undefined;

  if (smartKind === 'agent_condition') {
    task.instruction = buildConditionInstruction(business, cfg.branches);
  } else if (smartKind !== 'agent_data_fetch') {
    const hints = buildBusinessHints(business);
    if (hints) task.instruction = [task.instruction, hints].filter(Boolean).join('\n\n');
  }
  if (business.goal && (!task.goal || String(task.goal).startsWith('描述这个'))) task.goal = business.goal;

  const outputSchema = smartKind === 'agent_data_fetch' ? 'structured_data_extract_result'
    : smartKind === 'agent_condition' ? 'agent_condition_route_result'
      : task.outputSchema ?? task.outputTemplateId ?? 'generic_data_result';
  const completionContract = normalizeCompletionContract(
    guardrails.completionContract ?? cfg.completionContract,
    smartKind,
    outputSchema,
    task,
    guardrails,
  );
  const branches = Array.isArray(cfg.branches) ? cfg.branches.map((branch: Record<string, unknown>) => ({
    branchKey: String(branch.branchKey ?? branch.key ?? ''),
    label: String(branch.label ?? branch.branchKey ?? branch.key ?? ''),
    description: String(branch.description ?? ''),
    routeRuleHint: String(branch.routeRuleHint ?? ''),
    isFallback: Boolean(branch.isFallback),
  })) : undefined;

  return {
    schemaVersion: 'agent-run-spec/v1',
    workflowId: ctx.workflowId,
    workflowVersion: ctx.versionId,
    runId: ctx.runId,
    nodeId: String(node?.id ?? ''),
    task: { name: String(node?.name ?? ''), goal: String(task.goal ?? ''), instruction: String(task.instruction ?? ''), outputSchema, outputTemplateId: task.outputTemplateId },
    target: {
      provider: 'client_local', kind: business.kind ?? smartKind ?? node?.type ?? 'agent_task',
      model: runtime.model, agentId: runtime.agentId, endpointId: runtime.endpointId,
      credentialRef: runtime.credentialRef, profileId: runtime.capabilityProfileId,
      options: runtime.providerOptions,
    },
    inputs: unwrapRuntimeValues(ctx.resolvedInputs ?? {}),
    allowedSkills: guardrails.allowedSkills ?? [],
    allowedTools: guardrails.allowedTools ?? [],
    outputSchema,
    metadata: branches ? { branches } : undefined,
    runtimeContext: {
      ...(smartKind ? { smartNode: { kind: smartKind } } : {}),
      startup: { schema: ctx.startupSchema ?? {}, resolvedInputs: unwrapRuntimeValues(ctx.startupInputs ?? {}) },
      isFirstAgentNode: ctx.isFirstAgentNode !== false,
    },
    permissionPolicy: {
      // The desktop runtime has no SDK permission prompt bridge. Keep writes
      // sandboxed to the per-node workspace, but let an agent materialize its
      // declared local artifacts instead of waiting forever for an approval.
      mode: guardrails.approvalMode === 'none' ? 'readonly' : 'workspace_write',
      requireApprovalForTools: guardrails.approvalMode === 'none' ? [] : ['external_write', 'send_message', 'business_record_update'],
    },
    limits: { timeoutMs: guardrails.timeoutMs ?? 300_000, maxToolCalls: guardrails.maxToolCalls ?? 20 },
    completionContract,
    guardrails: { timeoutMs: typeof guardrails.timeoutMs === 'number' ? guardrails.timeoutMs : 300_000 },
    prompt: '',
  };
}

function normalizeCompletionContract(raw: any, smartKind: string | undefined, outputSchema: string, task: Record<string, any>, guardrails: Record<string, any>) {
  const resultKind = smartKind === 'agent_data_fetch' ? 'structured_data_extract_result'
    : smartKind === 'agent_condition' ? 'agent_condition_route_result' : outputSchema;
  const fallback = {
    resultKind,
    contentMode: 'structured_json',
    outputJsonSchema: { type: 'object', required: ['kind', 'version', 'status', 'data'], properties: {
      kind: { type: 'string', enum: [resultKind] }, version: { type: 'string', enum: ['1'] },
      status: { type: 'string', enum: ['succeeded'] }, data: smartKind === 'agent_condition' ? { type: 'object', required: ['branch_key'], properties: { branch_key: { type: 'string' } } } : { type: 'object' },
    } },
  };
  const contract = { ...fallback, ...(raw ?? {}) };
  contract.outputJsonSchema ??= guardrails.outputJsonSchema ?? fallback.outputJsonSchema;
  contract.maxAttempts ??= typeof task.maxAttempts === 'number' ? task.maxAttempts : 2;
  contract.onIncomplete ??= task.onIncomplete === 'manual_review' ? 'manual_review' : 'retry';
  contract.task = { ...task, ...(contract.task ?? {}) };
  return contract;
}

function unwrapRuntimeValues(value: any): any {
  if (Array.isArray(value)) return value.map(unwrapRuntimeValues);
  if (value && typeof value === 'object') {
    if (value.kind === 'json' && 'value' in value) return unwrapRuntimeValues(value.value);
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, unwrapRuntimeValues(nested)]));
  }
  return value;
}

function buildBusinessHints(business: Record<string, any>): string {
  const fields: Array<[string, string]> = [['goal', '业务目标'], ['rule', '处理规则'], ['subject', '分析对象'], ['contextNote', '补充上下文'], ['threshold', '阈值说明'], ['formatPreference', '格式偏好']];
  const lines = fields.flatMap(([key, label]) => business?.[key] ? [`${label}：${business[key]}`] : []);
  if (Array.isArray(business?.dimensions) && business.dimensions.length) lines.push(`汇总维度：${business.dimensions.filter(Boolean).join(', ')}`);
  return lines.join('\n');
}

function buildConditionInstruction(business: Record<string, any>, branches: any[]): string {
  const lines = buildBusinessHints(business).split('\n').filter(Boolean);
  const validBranches = Array.isArray(branches) ? branches.filter((branch) => branch?.branchKey ?? branch?.key) : [];
  if (validBranches.length) {
    lines.push('可选分支：');
    for (const branch of validBranches) {
      const key = branch.branchKey ?? branch.key;
      lines.push(`- branch_key: ${key}`);
      lines.push(`  label: ${branch.label ?? key}`);
      if (branch.description) lines.push(`  含义: ${branch.description}`);
      if (branch.routeRuleHint) lines.push(`  命中建议: ${branch.routeRuleHint}`);
    }
    const fallback = validBranches.find((branch) => branch.isFallback)?.branchKey ?? validBranches.find((branch) => branch.isFallback)?.key;
    lines.push('决策要求：', '- 只能返回一个 branch_key', '- branch_key 必须来自以上列表', fallback ? `- 如无法确定，返回兜底分支 ${fallback}` : '- 如无法确定，返回兜底分支');
  }
  return lines.join('\n');
}
