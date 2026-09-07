import { createSclawCapabilityToken, type SclawAgentEngine } from '../../../../shared/agent-extensions';

export interface WorkflowTemplateSearchItem {
  id: string;
  label: string;
  description?: string;
  matchScore?: number;
}

export interface WorkflowStartupSchemaResponse {
  templateId: string;
  schemaHash: string;
  schema: {
    fields: unknown[];
    steps: unknown[];
    nodeId: string;
    enabled: boolean;
  };
}

export interface WorkflowCreateResponse {
  workflowId: string;
  workflowName: string;
  defaultPresetId: string;
  schemaHash: string;
  startupValues: Record<string, unknown>;
}

export interface WorkflowStartResponse {
  runId: string;
  workflowId: string;
  status: string;
  startedAt?: string;
}

export interface WorkflowRunResponse extends Record<string, unknown> {
  runId: string;
  workflowId: string;
  status: string;
}

export interface StoWorkflowPort {
  isAvailable(): Promise<boolean>;
  searchTemplates(query: string, limit: number): Promise<WorkflowTemplateSearchItem[]>;
  getStartupSchema(templateId: string): Promise<WorkflowStartupSchemaResponse>;
  createWorkflow(input: {
    templateId: string;
    displayName?: string;
    schemaHash: string;
    values: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<WorkflowCreateResponse>;
  startWorkflow(input: {
    workflowId: string;
    inputs: Record<string, unknown>;
    idempotencyKey: string;
    sessionKey: string;
    templateName?: string;
    engineType: SclawAgentEngine;
  }): Promise<WorkflowStartResponse>;
  getRun(runId: string): Promise<WorkflowRunResponse>;
}

export const STO_WORKFLOW_CAPABILITY = createSclawCapabilityToken<StoWorkflowPort>('sto.workflow');
