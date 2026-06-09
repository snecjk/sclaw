/**
 * Workflow Template Types
 *
 * Defines the structure for workflow templates, schema fields,
 * execution states, and form mapping.
 *
 * Aligned with Agent Workflow Client API v1.
 */

// ── API Response Wrapper ────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  traceId: string;
  errCode?: string;
  errMessage?: string;
}

// ── Template Search ─────────────────────────────────────────────

export interface WorkflowTemplateSearchItem {
  id: string;
  label: string;
  description: string;
  category?: string;
  scope?: string;
  nodeCount?: number;
  nodes?: Array<{ id: string; type: string; name: string }>;
  edges?: unknown[];
  matchScore?: number;
  matchReason?: string[];
  resultType?: 'matched' | 'recommended';
}

export interface WorkflowTemplateSearchResponse {
  matchedItems: WorkflowTemplateSearchItem[];
  recommendedItems: WorkflowTemplateSearchItem[];
}

// ── Startup Schema ──────────────────────────────────────────────

export interface WorkflowSchemaField {
  key: string;
  label: string;
  description?: string;
  group: string;
  groupTitle?: string;
  order: number;
  component: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: Array<WorkflowFieldOption>;
  sourceNodes?: string[];
  extractable?: boolean;
  extractPattern?: string;
}

export interface WorkflowFieldOption {
  value: string;
  label: string;
  description?: string;
}

export interface WorkflowStep {
  id: string;
  title: string;
  mode: 'confirm' | 'auto' | string;
  order: number;
}

export interface WorkflowSchema {
  nodeId: string;
  enabled: boolean;
  steps: WorkflowStep[];
  fields: WorkflowSchemaField[];
}

export interface StartupSchemaResponse {
  templateId: string;
  schemaHash: string;
  schema: WorkflowSchema;
}

// ── Workflow Creation ───────────────────────────────────────────

export interface StartupPreset {
  name: string;
  values: Record<string, unknown>;
  isDefault: boolean;
  schemaHash: string;
}

export interface WorkflowStartupPayload {
  schemaHash: string;
  values: Record<string, unknown>;
}

export interface CreateWorkflowRequest {
  displayName?: string;
  templateId: string;
  startup: WorkflowStartupPayload;
  idempotencyKey?: string;
}

export interface CreateWorkflowResponse {
  workflowId: string;
  workflowName: string;
  defaultPresetId: string;
  schemaHash: string;
  startupValues: Record<string, unknown>;
}

// ── Workflow Detail ─────────────────────────────────────────────

export interface WorkflowGraphNode {
  id: string;
  type: string;
  name: string;
}

export interface WorkflowGraphEdge {
  id: string;
  source: string;
  target: string;
}

export interface WorkflowDefaultPreset {
  id: string;
  name: string;
  workflowId: string;
  workflowVersionId: number;
  ownerUserId?: string;
  values: Record<string, unknown>;
  schemaHash: string;
  isDefault: boolean;
  status: string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface WorkflowStartupDetail {
  schemaHash: string;
  schema: WorkflowSchema;
  defaultPreset: WorkflowDefaultPreset | null;
}

export interface WorkflowDetailResponse {
  workflowId: string;
  workflowName: string;
  description?: string | null;
  schemaVersion?: string | null;
  version: number;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  startup: WorkflowStartupDetail;
}

// ── Workflow Start ──────────────────────────────────────────────

export interface StartWorkflowRequest {
  inputs?: Record<string, unknown>;
  agentContext?: Record<string, unknown>;
  idempotencyKey: string;
}

// ── Run / Execution ─────────────────────────────────────────────

export type WorkflowRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'unknown';

export interface WorkflowRunNodeRun {
  id: string;
  nodeId: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface WorkflowRunArtifact {
  id: string;
  name: string;
  type: string;
  url: string;
  size?: number;
}

export interface WorkflowRunStartupInfo {
  schemaHash: string;
  schema: WorkflowSchema;
  presetId: string;
  presetName: string;
  presetVersionId: number;
  overrides?: Record<string, unknown>;
  resolvedInputs?: Record<string, unknown>;
}

export interface WorkflowRunInput {
  inputs: Record<string, unknown>;
  agentContext: Record<string, unknown>;
  startup: WorkflowRunStartupInfo;
}

export interface WorkflowRunResponse {
  id: string;
  workflowId: string;
  status: WorkflowRunStatus;
  mode?: string | null;
  startedAt: string;
  completedAt?: string | null;
  waitingNodeId?: string | null;
  nodeRuns: WorkflowRunNodeRun[];
  events: unknown[];
  approvalTasks: unknown[];
  userInputTasks: unknown[];
  artifacts: WorkflowRunArtifact[];
  toolInvocations: unknown[];
  input: WorkflowRunInput;
  output: unknown | null;
  startup: WorkflowRunStartupInfo;
  lastAgentRawText?: string | null;
  error: string | null;
}

// ── Legacy / UI-friendly execution state ────────────────────────

export interface WorkflowExecutionStep {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  duration?: number;
  error?: string;
}

export interface WorkflowExecutionResult {
  summary?: string;
  kpis?: Array<{
    name: string;
    value: string | number;
    change?: number;
    changeType?: 'increase' | 'decrease';
  }>;
  artifacts?: Array<{
    id: string;
    name: string;
    type: string;
    url: string;
    size?: number;
  }>;
}

/** UI-facing execution state derived from WorkflowRunResponse */
export interface WorkflowExecutionState {
  runId: string;
  workflowId: string;
  status: WorkflowRunStatus;
  progress: number;
  currentStep?: string;
  startedAt?: string;
  completedAt?: string;
  steps: WorkflowExecutionStep[];
  result?: WorkflowExecutionResult;
  error?: string;
}

// ── Content Block ───────────────────────────────────────────────

/** Workflow execution card reference in message content */
export interface WorkflowCardBlock {
  type: 'workflow_card';
  runId: string;
  templateName: string;
}
