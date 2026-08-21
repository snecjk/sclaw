import type { AgentEngineType } from '../../../engines/types';
import type { DingTalkMention } from '../../../../shared/dingtalk-send/dingtalk-mention';

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

export type ScheduleTaskSyncStatus = 'pending' | 'done';

export interface ScheduleTaskRetryPolicy {
  maxAttempts: number;
  backoffSec: number;
}

export interface ScheduleTaskFailurePolicy {
  pauseAfterConsecutiveFailures: number;
}

export interface ScheduleTaskRuntimeResult {
  stopReason: string | null;
  isError: boolean;
  durationMs: number;
}

/**
 * 定时任务领域对象（一行 schedule_tasks 的 camelCase 映射）。
 * 引擎无关；engineType 区分 openclaw / claude。
 */
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
  /** 【我的产物】目录路径 */
  myArtifactFolderPath: string | null;
  /** 【网点共享产物】目录路径 */
  sharedArtifactFolderPath: string | null;
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
  syncStatus: ScheduleTaskSyncStatus;
  remoteVersion: number | null;
  createdBy: string | null;
  updatedBy: string | null;
}

/**
 * 定时任务运行记录领域对象（一行 schedule_task_runs 的 camelCase 映射）。
 */
export interface ScheduleTaskRun {
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
