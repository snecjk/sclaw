export interface RunCtx {
  runId: string;
  workflowId: string;
  versionId: string;
  definition: any;
  repo: import('../../db/repositories/workflow-runtime-repository').WorkflowRuntimeRepository;
  resolvedInputs?: any;
  startupInputs?: Record<string, unknown>;
  startupSchema?: Record<string, unknown>;
  isFirstAgentNode?: boolean;
  upstreamSummary?: string;
  emit: (type: string, payload: any, nodeId?: string) => Promise<void>;
}

export interface NodeResult { action: 'continue' | 'pause'; output?: any; }

export interface AgentRunSpec {
  schemaVersion: 'agent-run-spec/v1';
  workflowId: string;
  workflowVersion: string | number;
  runId: string;
  nodeId: string;
  task: { name: string; goal: string; instruction: string; outputSchema?: string; outputTemplateId?: string };
  target: {
    provider: string;
    kind: string;
    model?: string;
    agentId?: string;
    endpointId?: string;
    credentialRef?: string;
    profileId?: string;
    options?: Record<string, unknown>;
  };
  inputs: any;
  allowedSkills: string[];
  allowedTools: string[];
  outputSchema: string;
  metadata?: { branches?: Array<Record<string, unknown>> };
  runtimeContext: {
    smartNode?: { kind: string };
    startup: { schema: Record<string, unknown>; resolvedInputs: Record<string, unknown> };
    isFirstAgentNode: boolean;
  };
  permissionPolicy: { mode: string; requireApprovalForTools?: string[] };
  limits: { timeoutMs?: number; maxToolCalls?: number };
  completionContract: {
    resultKind?: string;
    contentMode?: string;
    dataJsonSchema?: any;
    outputJsonSchema: any;
    responseExample?: Record<string, unknown>;
    maxAttempts?: number;
    onIncomplete?: 'retry' | 'manual_review';
    task?: any;
  };
  guardrails?: { timeoutMs?: number };
  prompt: string;
}

export interface AgentNodeResult { status: 'succeeded' | 'failed' | 'manual_review'; output?: any; error?: string; rawText?: string; usage?: any; }
