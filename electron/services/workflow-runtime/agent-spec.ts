/**
 * compileAgentRunSpec — TS 移植自 memory-center/src/services/workflow_core/compiler.py
 * 组装 AgentRunSpec + completionContract；客户端 provider 恒 client_local。
 */
import type { AgentRunSpec } from './types';

export function compileAgentRunSpec(node: any, _ctx: any): AgentRunSpec {
  const cfg = node?.config ?? {};
  const ac = cfg.agentConfig ?? {};
  const task = ac.task ?? {};
  const contract = cfg.completionContract ?? {
    outputJsonSchema: task.outputSchema ?? task.outputJsonSchema ?? { type: 'object' },
    maxAttempts: typeof task.maxAttempts === 'number' ? task.maxAttempts : 2,
    onIncomplete: (task.onIncomplete === 'manual_review' ? 'manual_review' : 'retry'),
  };
  return {
    target: { provider: 'client_local', kind: cfg.businessConfig?.kind ?? node?.type ?? 'agent_task' },
    completionContract: contract,
    prompt: '',  // 由 prompt-builder 填充
  };
}
