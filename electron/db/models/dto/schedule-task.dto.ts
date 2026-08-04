import type { AgentEngineType } from '../../../engines/types';
import type { DingTalkMention } from '../../../../shared/dingtalk-send/dingtalk-mention';
import type {
  ScheduleTaskFailurePolicy,
  ScheduleTaskPermissionProfile,
  ScheduleTaskRetryPolicy,
  ScheduleTaskRunStatus,
  ScheduleTaskRuntimeResult,
  ScheduleTaskTriggerSource,
} from '../domain/schedule-task';

export interface CreateScheduleTaskInput {
  id?: string;
  name: string;
  enabled?: boolean;
  cronExpr: string;
  engineType: AgentEngineType;
  prompt: string;
  agentId: string;
  /** 两引擎共享、可空、不与 skillCode 互斥 */
  workflowCode?: string | null;
  /** 引用 skill，与 workflowCode 同级、可空 */
  skillCode?: string | null;
  dingtalkRecipients?: DingTalkMention[] | null;
  /** openclaw 迁自 payload.model；claude 迁自顶层 model */
  model?: string | null;
  provider?: string | null;
  /** claude providerAccountId */
  accountId?: string | null;
  workspacePath?: string | null;
  /** 【我的产物】目录路径 */
  myArtifactFolderPath?: string | null;
  /** 【网点共享产物】目录路径 */
  sharedArtifactFolderPath?: string | null;
  permissionProfile?: ScheduleTaskPermissionProfile | null;
  timeoutSec?: number | null;
  retryPolicy?: ScheduleTaskRetryPolicy | null;
  failurePolicy?: ScheduleTaskFailurePolicy | null;
  /** 兜底冗余 JSON（引擎专属未列字段 + 未来扩展） */
  extra?: Record<string, unknown> | null;
  actor?: string | null;
}

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
  /** 【我的产物】目录路径 */
  myArtifactFolderPath?: string | null;
  /** 【网点共享产物】目录路径 */
  sharedArtifactFolderPath?: string | null;
  permissionProfile?: ScheduleTaskPermissionProfile | null;
  timeoutSec?: number | null;
  retryPolicy?: ScheduleTaskRetryPolicy | null;
  failurePolicy?: ScheduleTaskFailurePolicy | null;
  extra?: Record<string, unknown> | null;
  actor?: string | null;
}

export interface ListScheduleTasksOptions {
  engineType?: AgentEngineType;
  agentId?: string;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
}

/** scheduler 维护的调度状态字段（next_run_at 等）*/
export interface UpdateScheduleTaskScheduleStateInput {
  nextRunAt?: string | null;
  lastScheduledFor?: string | null;
  lastRecoveredAt?: string | null;
  cronExprSnapshot?: string | null;
  actor?: string | null;
}

export interface CreateScheduleTaskRunInput {
  runId?: string;
  taskId: string;
  status?: ScheduleTaskRunStatus;
  triggerSource: ScheduleTaskTriggerSource;
  scheduledFor?: string | null;
  startedAt?: string | null;
  attempt?: number;
  idempotencyKey: string;
  sessionKey?: string | null;
  actor?: string | null;
}

export interface UpdateScheduleTaskRunInput {
  status?: ScheduleTaskRunStatus;
  startedAt?: string | null;
  completedAt?: string | null;
  sessionKey?: string | null;
  summary?: string | null;
  error?: string | null;
  runtimeResult?: ScheduleTaskRuntimeResult | null;
  actor?: string | null;
}

export interface ListScheduleTaskRunsOptions {
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
}
