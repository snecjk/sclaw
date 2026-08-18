import type { WorkflowSchema } from '@/types/workflow';

export const WORKFLOW_IFRAME_BRIDGE_PROTOCOL = 'stoclaw-workflow-bridge/v1';
export const WORKFLOW_HOST_INIT = 'workflow-host-init';
export const WORKFLOW_EDITOR_READY = 'workflow-editor-ready';
export const WORKFLOW_TRY_RUN_REQUEST = 'workflow-try-run-request';
export const WORKFLOW_TRY_RUN_STATE = 'workflow-try-run-state';
export const WORKFLOW_SAVE_DRAFT_REQUEST = 'workflow-save-draft-request';
export const WORKFLOW_SAVE_DRAFT_RESPONSE = 'workflow-save-draft-response';
export const WORKFLOW_SAVE_DRAFT_ERROR = 'workflow-save-draft-error';
export const WORKFLOW_BACK_REQUEST = 'workflow-back-request';
export const WORKFLOW_DRAFT_REQUEST = 'workflow-draft-request';
export const WORKFLOW_DRAFT_RESPONSE = 'workflow-draft-response';
export const WORKFLOW_DRAFT_ERROR = 'workflow-draft-error';
export const WORKFLOW_PERFORMANCE_METRIC = 'workflow-performance-metric';

export type WorkflowTryRunState =
  | 'idle'
  | 'confirming'
  | 'saving'
  | 'preparing'
  | 'running'
  | 'cancelled'
  | 'failed'
  | 'completed'
  | 'error';
export type WorkflowHostCapability = 'localTrialRun' | 'hostBack';
export type WorkflowEditorCapability = 'ownsHeader' | 'persistBeforeTrialRun';

export interface WorkflowBridgeStartupFieldOption {
  value: string;
  label: string;
  description?: string;
  tags?: string[];
}

export interface WorkflowBridgeStartupTitledGroupItem {
  fieldKey: string;
  label: string;
  description?: string;
  defaultValue?: string;
}

export interface WorkflowBridgeStartupField {
  key: string;
  label: string;
  description?: string;
  group: string;
  groupTitle?: string;
  order?: number;
  component?: string;
  required?: boolean;
  sourceNodes?: string[];
  defaultValue?: unknown;
  options?: WorkflowBridgeStartupFieldOption[];
  items?: WorkflowBridgeStartupTitledGroupItem[];
}

export interface WorkflowBridgeStartupStep {
  id: string;
  title: string;
  mode?: string;
  order?: number;
}

export interface WorkflowBridgeStartupSchema {
  nodeId?: string | null;
  enabled: boolean;
  steps: WorkflowBridgeStartupStep[];
  fields: WorkflowBridgeStartupField[];
}

interface WorkflowBridgeEnvelope {
  protocol: typeof WORKFLOW_IFRAME_BRIDGE_PROTOCOL;
  workflowId: string;
  nonce: string;
  requestId: string;
}

export interface WorkflowHostInitMessage extends WorkflowBridgeEnvelope {
  type: typeof WORKFLOW_HOST_INIT;
  capabilities: WorkflowHostCapability[];
}

export interface WorkflowEditorReadyMessage extends WorkflowBridgeEnvelope {
  type: typeof WORKFLOW_EDITOR_READY;
  capabilities: WorkflowEditorCapability[];
}

export interface WorkflowTryRunRequestMessage extends WorkflowBridgeEnvelope {
  type: typeof WORKFLOW_TRY_RUN_REQUEST;
}

export interface WorkflowTryRunStateMessage extends WorkflowBridgeEnvelope {
  type: typeof WORKFLOW_TRY_RUN_STATE;
  state: WorkflowTryRunState;
  error?: string;
}

export interface WorkflowSaveDraftRequestMessage extends WorkflowBridgeEnvelope {
  type: typeof WORKFLOW_SAVE_DRAFT_REQUEST;
}

export interface WorkflowSavedDraftSnapshot {
  workflowId: string;
  workflowVersionId: string | number;
  schemaVersion: 'workflow/v2';
  versionStatus: 'draft';
  startup: {
    schema: WorkflowBridgeStartupSchema | null;
    defaultValues: Record<string, unknown>;
  };
}

export interface WorkflowSaveDraftResponseMessage extends WorkflowBridgeEnvelope, WorkflowSavedDraftSnapshot {
  type: typeof WORKFLOW_SAVE_DRAFT_RESPONSE;
}

export interface WorkflowSaveDraftErrorMessage extends WorkflowBridgeEnvelope {
  type: typeof WORKFLOW_SAVE_DRAFT_ERROR;
  message: string;
}

export interface WorkflowBackRequestMessage extends WorkflowBridgeEnvelope {
  type: typeof WORKFLOW_BACK_REQUEST;
}

export type WorkflowPerformanceStage =
  | 'designer_mounted'
  | 'workflow_loaded'
  | 'capabilities_loaded'
  | 'canvas_first_paint';

export interface WorkflowPerformanceMetricMessage {
  protocol: typeof WORKFLOW_IFRAME_BRIDGE_PROTOCOL;
  type: typeof WORKFLOW_PERFORMANCE_METRIC;
  workflowId: string;
  nonce: string;
  stage: WorkflowPerformanceStage;
  elapsedMs: number;
  error?: string;
}

export interface WorkflowDraftSnapshot {
  workflowId: string;
  /** Legacy bridge payload; retained only for compatibility and never executed by the client. */
  definition?: Record<string, unknown>;
  workflowVersionId: string | number;
  schemaVersion?: string;
  versionStatus?: 'draft' | 'published';
  startup: {
    schema: WorkflowSchema | null;
    defaultValues: Record<string, unknown>;
  };
}

export interface WorkflowDraftRequestMessage {
  protocol: typeof WORKFLOW_IFRAME_BRIDGE_PROTOCOL;
  type: typeof WORKFLOW_DRAFT_REQUEST;
  requestId: string;
  workflowId: string;
  nonce: string;
}

export interface WorkflowDraftResponseMessage extends WorkflowDraftSnapshot {
  protocol: typeof WORKFLOW_IFRAME_BRIDGE_PROTOCOL;
  type: typeof WORKFLOW_DRAFT_RESPONSE;
  requestId: string;
  nonce: string;
}

export interface WorkflowDraftErrorMessage {
  protocol: typeof WORKFLOW_IFRAME_BRIDGE_PROTOCOL;
  type: typeof WORKFLOW_DRAFT_ERROR;
  requestId: string;
  workflowId: string;
  nonce: string;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isWorkflowBridgeEnvelope(value: unknown): value is WorkflowBridgeEnvelope & Record<string, unknown> {
  if (!isRecord(value)) return false;
  return (
    value.protocol === WORKFLOW_IFRAME_BRIDGE_PROTOCOL &&
    typeof value.workflowId === 'string' &&
    typeof value.nonce === 'string' &&
    typeof value.requestId === 'string'
  );
}

function hasOnlyCapabilities(value: unknown, allowed: readonly string[]): value is string[] {
  return Array.isArray(value) && value.every(
    (capability) => typeof capability === 'string' && allowed.includes(capability),
  );
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function isOptionalStringArray(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'));
}

function isWorkflowBridgeStartupFieldOption(value: unknown): value is WorkflowBridgeStartupFieldOption {
  return (
    isRecord(value) &&
    typeof value.value === 'string' &&
    typeof value.label === 'string' &&
    isOptionalString(value.description) &&
    isOptionalStringArray(value.tags)
  );
}

function isWorkflowBridgeStartupTitledGroupItem(value: unknown): value is WorkflowBridgeStartupTitledGroupItem {
  return (
    isRecord(value) &&
    typeof value.fieldKey === 'string' &&
    typeof value.label === 'string' &&
    isOptionalString(value.description) &&
    isOptionalString(value.defaultValue)
  );
}

function isWorkflowBridgeStartupField(value: unknown): value is WorkflowBridgeStartupField {
  return (
    isRecord(value) &&
    typeof value.key === 'string' &&
    typeof value.label === 'string' &&
    typeof value.group === 'string' &&
    isOptionalString(value.description) &&
    isOptionalString(value.groupTitle) &&
    isOptionalFiniteNumber(value.order) &&
    isOptionalString(value.component) &&
    (value.required === undefined || typeof value.required === 'boolean') &&
    isOptionalStringArray(value.sourceNodes) &&
    (value.options === undefined || (
      Array.isArray(value.options) && value.options.every(isWorkflowBridgeStartupFieldOption)
    )) &&
    (value.items === undefined || (
      Array.isArray(value.items) && value.items.every(isWorkflowBridgeStartupTitledGroupItem)
    ))
  );
}

function isWorkflowBridgeStartupStep(value: unknown): value is WorkflowBridgeStartupStep {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    isOptionalString(value.mode) &&
    isOptionalFiniteNumber(value.order)
  );
}

function isWorkflowBridgeStartupSchema(value: unknown): value is WorkflowBridgeStartupSchema {
  return (
    isRecord(value) &&
    (value.nodeId === undefined || value.nodeId === null || typeof value.nodeId === 'string') &&
    typeof value.enabled === 'boolean' &&
    Array.isArray(value.steps) &&
    value.steps.every(isWorkflowBridgeStartupStep) &&
    Array.isArray(value.fields) &&
    value.fields.every(isWorkflowBridgeStartupField)
  );
}

export function isWorkflowEditorReady(value: unknown): value is WorkflowEditorReadyMessage {
  return (
    isWorkflowBridgeEnvelope(value) &&
    value.type === WORKFLOW_EDITOR_READY &&
    hasOnlyCapabilities(value.capabilities, ['ownsHeader', 'persistBeforeTrialRun'])
  );
}

export function isWorkflowTryRunRequest(value: unknown): value is WorkflowTryRunRequestMessage {
  return isWorkflowBridgeEnvelope(value) && value.type === WORKFLOW_TRY_RUN_REQUEST;
}

export function isWorkflowBackRequest(value: unknown): value is WorkflowBackRequestMessage {
  return isWorkflowBridgeEnvelope(value) && value.type === WORKFLOW_BACK_REQUEST;
}

export function isWorkflowSaveDraftResponse(value: unknown): value is WorkflowSaveDraftResponseMessage {
  if (!isWorkflowBridgeEnvelope(value) || value.type !== WORKFLOW_SAVE_DRAFT_RESPONSE) return false;
  const startup = value.startup;
  return (
    (typeof value.workflowVersionId === 'string' || typeof value.workflowVersionId === 'number') &&
    value.schemaVersion === 'workflow/v2' &&
    value.versionStatus === 'draft' &&
    isRecord(startup) &&
    Object.hasOwn(startup, 'schema') &&
    (startup.schema === null || isWorkflowBridgeStartupSchema(startup.schema)) &&
    isRecord(startup.defaultValues)
  );
}

export function isWorkflowSaveDraftError(value: unknown): value is WorkflowSaveDraftErrorMessage {
  return (
    isWorkflowBridgeEnvelope(value) &&
    value.type === WORKFLOW_SAVE_DRAFT_ERROR &&
    typeof value.message === 'string'
  );
}

export function createWorkflowBridgeNonce(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function isWorkflowDraftResponse(value: unknown): value is WorkflowDraftResponseMessage {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  const startup = data.startup as Record<string, unknown> | undefined;
  if (!startup) return false;
  return (
    data.protocol === WORKFLOW_IFRAME_BRIDGE_PROTOCOL &&
    data.type === WORKFLOW_DRAFT_RESPONSE &&
    typeof data.requestId === 'string' &&
    typeof data.nonce === 'string' &&
    typeof data.workflowId === 'string' &&
    (typeof data.workflowVersionId === 'string' || typeof data.workflowVersionId === 'number') &&
    data.schemaVersion === 'workflow/v2' &&
    (data.versionStatus === 'draft' || data.versionStatus === 'published') &&
    typeof startup.defaultValues === 'object'
  );
}

export function isWorkflowDraftError(value: unknown): value is WorkflowDraftErrorMessage {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return (
    data.protocol === WORKFLOW_IFRAME_BRIDGE_PROTOCOL &&
    data.type === WORKFLOW_DRAFT_ERROR &&
    typeof data.requestId === 'string' &&
    typeof data.nonce === 'string' &&
    typeof data.workflowId === 'string' &&
    typeof data.message === 'string'
  );
}

export function isWorkflowPerformanceMetric(value: unknown): value is WorkflowPerformanceMetricMessage {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return (
    data.protocol === WORKFLOW_IFRAME_BRIDGE_PROTOCOL &&
    data.type === WORKFLOW_PERFORMANCE_METRIC &&
    typeof data.workflowId === 'string' &&
    typeof data.nonce === 'string' &&
    ['designer_mounted', 'workflow_loaded', 'capabilities_loaded', 'canvas_first_paint'].includes(String(data.stage)) &&
    typeof data.elapsedMs === 'number' &&
    Number.isFinite(data.elapsedMs) &&
    data.elapsedMs >= 0 &&
    (data.error === undefined || typeof data.error === 'string')
  );
}
