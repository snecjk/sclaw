export interface RunCtx { runId: string; workflowId: string; versionId: string;
  definition: any; repo: import('../../db/repositories/workflow-runtime-repository').WorkflowRuntimeRepository;
  resolvedInputs?: any; startupInputs?: Record<string, unknown>; upstreamSummary?: string;
  emit: (type: string, payload: any, nodeId?: string) => Promise<void>; }
export interface NodeResult { action: 'continue' | 'pause'; output?: any; }
export interface AgentRunSpec { target: { provider: string; kind: string; model?: string; agentId?: string };
  inputs?: any; allowedSkills?: string[]; allowedTools?: string[];
  permissionPolicy?: { mode: string; requireApprovalForTools?: string[] };
  limits?: { timeoutMs?: number; maxToolCalls?: number };
  completionContract: { outputJsonSchema: any; maxAttempts?: number; onIncomplete?: 'retry' | 'manual_review'; task?: any };
  guardrails?: { timeoutMs?: number };
  prompt: string; }
export interface AgentNodeResult { status: 'succeeded' | 'failed' | 'manual_review'; output?: any; error?: string; rawText?: string; usage?: any; }
