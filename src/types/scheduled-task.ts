/**
 * Scheduled Task Types (local /agent runtime).
 *
 * 统一定时任务型 — 镜像 electron/db/models/domain/schedule-task.ts 的 ScheduleTask。
 * 任务管理流（stores/cron.ts、MyTask、AgentDetailPage、use-scheduled-task-name-maps）
 * 全量用 ScheduleTask；旧 ClaudeScheduledTask* 型保留予会话渲染流（遗留 store 仍吐该形状）。
 */
import type { DingTalkMention } from './dingtalk-mention';

/** 引擎类型 — 镜像 electron/utils/agent-config.ts AgentEngineType。 */
export type AgentEngineType = 'openclaw' | 'claude';

export type ScheduleTaskPermissionProfile =
  | 'readonly-safe'
  | 'workspace-write'
  | 'dangerous-bypass';

export type ScheduleTaskRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'cancelled';

export type ScheduleTaskTriggerSource = 'manual' | 'schedule' | 'recovery';

export interface ScheduleTaskRetryPolicy {
  maxAttempts: number;
  backoffSec: number;
}

export interface ScheduleTaskFailurePolicy {
  pauseAfterConsecutiveFailures: number;
}

/** 统一定时任务 — 镜像 electron/db/models/domain/schedule-task.ts ScheduleTask。 */
export interface ScheduleTask {
  id: string;
  name: string;
  enabled: boolean;
  cronExpr: string;
  engineType: AgentEngineType;
  prompt: string;
  agentId: string;
  workflowCode: string | null;
  skillCode: string | null;
  dingtalkRecipients: DingTalkMention[] | null;
  model: string | null;
  provider: string | null;
  accountId: string | null;
  workspacePath: string | null;
  permissionProfile: ScheduleTaskPermissionProfile | null;
  timeoutSec: number | null;
  retryPolicy: ScheduleTaskRetryPolicy | null;
  failurePolicy: ScheduleTaskFailurePolicy | null;
  extra: Record<string, unknown> | null;
  nextRunAt: string | null;
  lastScheduledFor: string | null;
  lastRecoveredAt: string | null;
  cronExprSnapshot: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  version: number;
}

/** 建任务输入 — 镜像 electron/db/models/dto/schedule-task.dto.ts CreateScheduleTaskInput。 */
export interface CreateScheduleTaskInput {
  id?: string;
  name: string;
  enabled?: boolean;
  cronExpr: string;
  engineType: AgentEngineType;
  prompt: string;
  agentId: string;
  workflowCode?: string | null;
  skillCode?: string | null;
  dingtalkRecipients?: DingTalkMention[] | null;
  model?: string | null;
  provider?: string | null;
  accountId?: string | null;
  workspacePath?: string | null;
  permissionProfile?: ScheduleTaskPermissionProfile | null;
  timeoutSec?: number | null;
  retryPolicy?: ScheduleTaskRetryPolicy | null;
  failurePolicy?: ScheduleTaskFailurePolicy | null;
  extra?: Record<string, unknown> | null;
  actor?: string | null;
}

/** 改任务输入 — 镜像 UpdateScheduleTaskInput。 */
export interface UpdateScheduleTaskInput {
  name?: string;
  enabled?: boolean;
  cronExpr?: string;
  prompt?: string;
  workflowCode?: string | null;
  skillCode?: string | null;
  dingtalkRecipients?: DingTalkMention[] | null;
  model?: string | null;
  provider?: string | null;
  accountId?: string | null;
  workspacePath?: string | null;
  permissionProfile?: ScheduleTaskPermissionProfile | null;
  timeoutSec?: number | null;
  retryPolicy?: ScheduleTaskRetryPolicy | null;
  failurePolicy?: ScheduleTaskFailurePolicy | null;
  extra?: Record<string, unknown> | null;
  actor?: string | null;
}

export interface ScheduleTaskRuntimeResult {
  stopReason: string | null;
  isError: boolean;
  durationMs: number;
}

/** 单次运行记录 — 镜像 electron/db/models/domain/schedule-task.ts ScheduleTaskRun。 */
export interface ScheduleTaskRunRecord {
  runId: string;
  taskId: string;
  status: ScheduleTaskRunStatus;
  triggerSource: ScheduleTaskTriggerSource;
  scheduledFor: string | null;
  startedAt: string | null;
  completedAt: string | null;
  attempt: number;
  idempotencyKey: string;
  sessionKey: string | null;
  summary: string | null;
  error: string | null;
  runtimeResult: ScheduleTaskRuntimeResult | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
}

// ---------------------------------------------------------------------------
// Legacy Claude scheduled-task types — 会话渲染流仍用（遗留 session store 吐该形状）。
// 任务管理流已迁 ScheduleTask，勿在新代码用这些。
// ---------------------------------------------------------------------------

/** @deprecated 旧名，新代码用 ScheduleTaskPermissionProfile */
export type ClaudeTaskPermissionProfile = ScheduleTaskPermissionProfile;

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
