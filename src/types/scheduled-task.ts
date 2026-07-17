/**
 * Scheduled Task Types (STO Scheduled Tasks API)
 */

import type { DingTalkMention } from './dingtalk-mention';

export interface ScheduledTask {
  id: number;
  ownerUserId: string;
  name: string;
  taskType: string;
  description: string;
  cronExpr: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  notifyMode: string | null;
  siteCode: string | null;
  siteName: string | null;
  dingdingId: string | null;
  dingdingGroupId: string | null;
  dingdingGroupName: string | null;
  ossObjectKey: string | null;
  dialogSessionKey: string | null;
  openclawGatewayUrl: string | null;
  workflowCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledTaskCreateInput {
  name: string;
  cronExpr: string;
  description?: string;
  taskType?: string;
  notifyMode?: string;
  siteCode?: string;
  siteName?: string;
  dingdingId?: string;
  dingdingGroupId?: string;
  dingdingGroupName?: string;
  dialogSessionKey?: string;
  openclawGatewayUrl?: string;
  dingTalkMentions?: DingTalkMention[];
  workflowCode?: string;
}

export interface ScheduledTaskUpdateInput {
  taskId: number;
  name?: string;
  cronExpr?: string;
  description?: string;
  notifyMode?: string;
  enabled?: boolean;
  dingdingId?: string;
  dingdingGroupId?: string;
  dingdingGroupName?: string;
  dingTalkMentions?: DingTalkMention[];
  workflowCode?: string;
}

export interface ScheduledTaskRun {
  id: number;
  taskId: number;
  status: string;
  executionResult?: string;
  logText?: string;
  notifyDingtalkOk?: boolean;
}

export interface ScheduledTaskTriggerResponse {
  taskId: number;
  runId: number;
  outcome: string;
  run?: ScheduledTaskRun;
  hasSession?: boolean;
  executionSessionKey?: string;
  executionModel?: string;
  executionAgentId?: string;
}

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

export type ManagedScheduledTask =
  | ({ engineType: 'openclaw' } & ScheduledTask)
  | ({ engineType: 'claude' } & ClaudeScheduledTask);

export type ManagedScheduledTaskTriggerResponse =
  | ({ engineType: 'openclaw' } & ScheduledTaskTriggerResponse)
  | ({ engineType: 'claude' } & ClaudeScheduledTaskRunRecord);
