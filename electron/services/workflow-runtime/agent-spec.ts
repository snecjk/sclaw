/**
 * compileAgentRunSpec — TS 移植自 memory-center/src/services/workflow_core/compiler.py
 * 组装 AgentRunSpec + completionContract；客户端 provider 恒 client_local。
 */
import type { AgentRunSpec } from './types';

export function compileAgentRunSpec(node: any, _ctx: any): AgentRunSpec {
  const cfg = node?.config ?? {};
  const ac = cfg.agentConfig ?? {};
  const task = { ...(cfg.task ?? ac.task ?? {}) };
  const guardrails = cfg.guardrails ?? ac.guardrails ?? {};
  const runtime = cfg.runtime ?? ac.runtime ?? {};
  const business = cfg.businessConfig ?? {};
  const businessHints = buildBusinessHints(business, cfg.branches);
  if (businessHints) task.instruction = [task.instruction, businessHints].filter(Boolean).join('\n\n');
  const rawContract = guardrails.completionContract ?? cfg.completionContract;
  const contract = rawContract ? { ...rawContract } : {
    ...defaultCompletionContract(node?.type, task.outputTemplateId ?? task.outputSchema),
    outputJsonSchema: guardrails.outputJsonSchema ?? task.outputJsonSchema ?? defaultCompletionContract(node?.type, task.outputTemplateId ?? task.outputSchema).outputJsonSchema,
    maxAttempts: typeof task.maxAttempts === 'number' ? task.maxAttempts : 2,
    onIncomplete: (task.onIncomplete === 'manual_review' ? 'manual_review' : 'retry'),
  };
  contract.outputJsonSchema ??= guardrails.outputJsonSchema ?? { type: 'object' };
  contract.maxAttempts ??= typeof task.maxAttempts === 'number' ? task.maxAttempts : 2;
  contract.onIncomplete ??= task.onIncomplete === 'manual_review' ? 'manual_review' : 'retry';
  contract.task ??= task;
  return {
    target: { provider: 'client_local', kind: business.kind ?? node?.type ?? 'agent_task', model: runtime.model, agentId: runtime.agentId },
    inputs: _ctx?.resolvedInputs ?? {},
    allowedSkills: guardrails.allowedSkills ?? [],
    allowedTools: guardrails.allowedTools ?? [],
    permissionPolicy: {
      mode: guardrails.approvalMode === 'none' ? 'readonly' : 'approval_required',
      requireApprovalForTools: guardrails.approvalMode === 'none' ? [] : ['external_write', 'send_message', 'business_record_update'],
    },
    limits: { timeoutMs: guardrails.timeoutMs ?? 300_000, maxToolCalls: guardrails.maxToolCalls ?? 20 },
    completionContract: contract,
    guardrails: { timeoutMs: typeof guardrails.timeoutMs === 'number' ? guardrails.timeoutMs : 300_000 },
    prompt: '',  // 由 prompt-builder 填充
  };
}

function defaultCompletionContract(nodeType: string, templateId: unknown): Record<string, any> {
  const resultKind = nodeType === 'agent_data_fetch' ? 'structured_data_extract_result'
    : nodeType === 'agent_condition' ? 'agent_condition_route_result'
      : typeof templateId === 'string' && templateId ? templateId : 'generic_data_result';
  const dataSchema = nodeType === 'agent_condition'
    ? { type: 'object', required: ['branch_key'], properties: { branch_key: { type: 'string' } } }
    : { type: 'object' };
  return {
    resultKind, contentMode: 'structured_json',
    outputJsonSchema: {
      type: 'object', required: ['kind', 'version', 'status', 'data'],
      properties: {
        kind: { type: 'string', enum: [resultKind] }, version: { type: 'string', enum: ['1'] },
        status: { type: 'string', enum: ['succeeded'] }, data: dataSchema,
      },
    },
  };
}

function buildBusinessHints(business: any, branches: any[]): string {
  const lines: string[] = [];
  const mapping: Array<[string, string]> = [
    ['goal', '业务目标'], ['rule', '处理规则'], ['subject', '分析对象'],
    ['contextNote', '补充上下文'], ['threshold', '阈值说明'], ['formatPreference', '格式偏好'],
  ];
  for (const [key, label] of mapping) if (business?.[key]) lines.push(`${label}：${business[key]}`);
  if (Array.isArray(business?.dimensions) && business.dimensions.length) lines.push(`汇总维度：${business.dimensions.join(', ')}`);
  if (Array.isArray(branches) && branches.length) {
    lines.push('可选分支：');
    for (const branch of branches) {
      const key = branch?.branchKey ?? branch?.key;
      if (key) lines.push(`- ${key}: ${branch.label ?? ''}${branch.routeRuleHint ? `（${branch.routeRuleHint}）` : ''}`);
    }
    lines.push('只能返回一个来自以上列表的 branch_key；无法判断时返回兜底分支。');
  }
  return lines.join('\n');
}
