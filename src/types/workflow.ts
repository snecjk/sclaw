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

// ── Template List (paginated) ─────────────────────────────────

export interface WorkflowTemplateSearchItem {
  id: string;
  label: string;
  description: string;
  category?: string;
  scope?: string;
  nodeCount?: number;
  nodes?: Array<{ id: string; type: string; name: string }>;
  edges?: unknown[];
  /** Client-side match hint when adapting paginated list for NL intent */
  matchScore?: number;
  matchReason?: string[];
  resultType?: 'matched' | 'recommended';
}

/** @deprecated Use WorkflowTemplateListResult — kept for intent/picker adapters */
export interface WorkflowTemplateSearchResponse {
  matchedItems: WorkflowTemplateSearchItem[];
  recommendedItems: WorkflowTemplateSearchItem[];
}

export interface WorkflowTemplateListApiResponse extends ApiResponse<WorkflowTemplateSearchItem[]> {
  total?: number;
  page?: number;
  pageSize?: number;
}

export interface WorkflowTemplateListResult {
  items: WorkflowTemplateSearchItem[];
  total: number;
  page: number;
  pageSize: number;
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
  /** titled_group 子项定义 */
  items?: Array<{
    fieldKey: string;
    label: string;
    description?: string;
    defaultValue?: string;
  }>;
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
  description?: string;
  config?: Record<string, unknown>;
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

/** POST /agent/v1/workflows/{workflowId}/start — lightweight launch confirmation */
export interface StartWorkflowResponse {
  runId: string;
  workflowId: string;
  status: WorkflowRunStatus;
  startedAt: string;
  queryUrl?: string | null;
  streamUrl?: string | null;
}

// ── My Workflow Summary ───────────────────────────────────────

/** 工作流生命周期状态（后端 _to_workflow_summary 输出 lowercase 字符串） */
export type WorkflowLifecycleStatus = 'active' | 'draft' | string;

/**
 * 工作流实例摘要 —— 与后端 `_to_workflow_summary` 同构。
 * 用于「我的工作流」列表项与 `latest-by-templates` 返回值（无实例时前端取 null）。
 */
export interface MyWorkflowSummary {
  /** 工作流实例 ID（workflow_id） */
  id: string;
  name: string;
  description?: string | null;
  /** 来源模版 ID（若由模版实例化） */
  templateId?: string | null;
  /** 当前展示版本 ID */
  versionId?: number | null;
  /** 当前展示版本号 */
  version?: number | null;
  /** 生命周期状态：active(已发布) / draft(草稿) */
  lifecycleStatus?: WorkflowLifecycleStatus | null;
  /** 版本状态（draft/published/...） */
  versionStatus?: string | null;
  /** 已发布激活版本 ID */
  activeVersionId?: string | number | null;
  /** 已发布激活版本号 */
  activeVersion?: number | null;
  /** 已发布激活版本状态 */
  activeVersionStatus?: string | null;
  updatedAt?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
  updatedBy?: string | null;
  updatedByName?: string | null;
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
  previewUrl?: string;
  tempUrl?: string;
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

export interface WorkflowRunClientResult {
  title?: string | null;
  summary?: string | null;
  status?: string | null;
  data?: unknown;
  artifacts?: Array<{
    id?: string;
    name?: string;
    kind?: string;
    type?: string;
    url?: string;
    tempUrl?: string;
    previewUrl?: string;
    filePath?: string;
    contentType?: string;
    size?: number;
  }>;
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
  /** Client result view (preferred over legacy `output`). */
  result?: WorkflowRunClientResult | null;
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
    previewUrl?: string;
    tempUrl?: string;
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
