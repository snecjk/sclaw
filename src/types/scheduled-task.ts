/**
 * Claude Scheduled Task Types (local /agent runtime).
 */

export type ClaudeTaskPermissionProfile =
  | 'readonly-safe'
  | 'workspace-write'
  | 'dangerous-bypass';

export interface ClaudeScheduledTaskLastRun {
  runId: string;
  status: string;
  scheduledFor: string;
  completedAt?: string;
  summary?: string;
  error?: string;
}

export interface ClaudeScheduledTask {
  id: string;
  name: string;
  enabled: boolean;
  cronExpr: string;
  promptTemplate: string;
  agentId: string;
  workspacePath: string;
  providerAccountId?: string;
  model?: string;
  permissionProfile: ClaudeTaskPermissionProfile;
  timeoutSec: number;
  workflowCode?: string;
  nextRunAt?: string;
  lastRun?: ClaudeScheduledTaskLastRun | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClaudeScheduledTaskCreateInput {
  name: string;
  cronExpr: string;
  promptTemplate: string;
  agentId: string;
  workspacePath: string;
  providerAccountId?: string;
  model?: string;
  permissionProfile?: ClaudeTaskPermissionProfile;
  timeoutSec?: number;
  workflowCode?: string;
}

export interface ClaudeScheduledTaskUpdateInput {
  id: string;
  name?: string;
  enabled?: boolean;
  cronExpr?: string;
  promptTemplate?: string;
  agentId?: string;
  workspacePath?: string;
  providerAccountId?: string;
  model?: string;
  permissionProfile?: ClaudeTaskPermissionProfile;
  timeoutSec?: number;
  workflowCode?: string;
}

export interface ClaudeScheduledTaskRunRecord {
  runId: string;
  taskId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled';
  triggerSource: 'manual' | 'schedule' | 'recovery';
  scheduledFor: string;
  startedAt?: string;
  completedAt?: string;
  attempt: number;
  idempotencyKey: string;
  sessionKey: string;
  summary?: string;
  error?: string;
  runtimeSnapshot?: {
    workspacePath?: string;
    providerAccountId?: string;
    model?: string;
    permissionProfile?: string;
    pluginPaths?: string[];
  };
  /** Host-api enrichment after trigger: dated UI session + persisted model */
  executionSessionKey?: string;
  executionModel?: string;
  executionAgentId?: string;
}

export interface TaskTriggerExecutionMeta {
  executionSessionKey?: string;
  executionModel?: string;
  executionAgentId?: string;
}
