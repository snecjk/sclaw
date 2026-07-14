export interface RunCtx { runId: string; workflowId: string; versionId: string;
  definition: any; repo: import('../../db/repositories/workflow-runtime-repository').WorkflowRuntimeRepository;
  emit: (type: string, payload: any, nodeId?: string) => Promise<void>; }
export interface NodeResult { action: 'continue' | 'pause'; output?: any; }
export interface AgentRunSpec { target: { provider: string; kind: string };
  completionContract: { outputJsonSchema: any; maxAttempts?: number; onIncomplete?: 'retry' | 'manual_review' };
  prompt: string; }
export interface AgentNodeResult { status: 'succeeded' | 'failed'; output?: any; error?: string; rawText?: string; usage?: any; }
