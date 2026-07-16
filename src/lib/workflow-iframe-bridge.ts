import type { WorkflowSchema } from '@/types/workflow';

export const WORKFLOW_IFRAME_BRIDGE_PROTOCOL = 'stoclaw-workflow-bridge/v1';
export const WORKFLOW_DRAFT_REQUEST = 'workflow-draft-request';
export const WORKFLOW_DRAFT_RESPONSE = 'workflow-draft-response';
export const WORKFLOW_DRAFT_ERROR = 'workflow-draft-error';

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
    data.versionStatus === 'draft' &&
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
