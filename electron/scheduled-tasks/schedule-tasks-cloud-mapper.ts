import type { ScheduleTask } from '../db/models/domain/schedule-task';
import type { CloudDefinitionUpsertInput } from '../db/repositories/schedule-task-repository';
import type { AgentEngineType } from '../engines/types';
import type { DingTalkMention } from '../../shared/dingtalk-send/dingtalk-mention';

/** 云端 `schedule_tasks_cloud` 行（snake_case，与 DDL 对齐）。 */
export interface CloudScheduleTaskRow {
  owner_user_id?: string;
  id: string;
  name: string;
  enabled: number;
  cron_expr: string;
  engine_type: string;
  prompt: string;
  agent_id: string;
  workflow_code: string | null;
  skill_code: string | null;
  dingtalk_recipients_json: string | null;
  model: string | null;
  provider: string | null;
  account_id: string | null;
  workspace_path: string | null;
  my_artifact_folder_path: string | null;
  shared_artifact_folder_path: string | null;
  permission_profile: string | null;
  timeout_sec: number | null;
  retry_policy_json: string | null;
  failure_policy_json: string | null;
  extra_json: string | null;
  next_run_at: string | null;
  last_scheduled_for: string | null;
  last_recovered_at: string | null;
  cron_expr_snapshot: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
  created_by: string | null;
  updated_by: string | null;
}

export type CloudScheduleTaskUpsertBody = Omit<
  CloudScheduleTaskRow,
  'owner_user_id' | 'version'
>;

function stringifyJson(value: unknown): string | null {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function parseJson<T>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw !== 'string') return raw as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** 本地行 → 云端 POST body。调度四列恒 null。 */
export function toCloudUpsertBody(task: ScheduleTask): CloudScheduleTaskUpsertBody {
  return {
    id: task.id,
    name: task.name,
    enabled: task.enabled ? 1 : 0,
    cron_expr: task.cronExpr,
    engine_type: task.engineType,
    prompt: task.prompt,
    agent_id: task.agentId,
    workflow_code: task.workflowCode,
    skill_code: task.skillCode,
    dingtalk_recipients_json: stringifyJson(task.dingtalkRecipients),
    model: task.model,
    provider: task.provider,
    account_id: task.accountId,
    workspace_path: task.workspacePath,
    my_artifact_folder_path: task.myArtifactFolderPath,
    shared_artifact_folder_path: task.sharedArtifactFolderPath,
    permission_profile: task.permissionProfile,
    timeout_sec: task.timeoutSec,
    retry_policy_json: stringifyJson(task.retryPolicy),
    failure_policy_json: stringifyJson(task.failurePolicy),
    extra_json: stringifyJson(task.extra),
    next_run_at: null,
    last_scheduled_for: null,
    last_recovered_at: null,
    cron_expr_snapshot: null,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    deleted_at: task.deletedAt,
    created_by: task.createdBy,
    updated_by: task.updatedBy,
  };
}

export function cloudRowToLocalDefinition(row: CloudScheduleTaskRow): CloudDefinitionUpsertInput {
  return {
    id: row.id,
    name: row.name,
    enabled: Number(row.enabled) === 1,
    cronExpr: row.cron_expr,
    engineType: row.engine_type as AgentEngineType,
    prompt: row.prompt,
    agentId: row.agent_id,
    workflowCode: row.workflow_code,
    skillCode: row.skill_code,
    dingtalkRecipients: parseJson<DingTalkMention[]>(row.dingtalk_recipients_json),
    model: row.model,
    provider: row.provider,
    accountId: row.account_id,
    workspacePath: row.workspace_path,
    myArtifactFolderPath: row.my_artifact_folder_path,
    sharedArtifactFolderPath: row.shared_artifact_folder_path,
    permissionProfile: row.permission_profile as ScheduleTask['permissionProfile'],
    timeoutSec: row.timeout_sec,
    retryPolicy: parseJson<ScheduleTask['retryPolicy']>(row.retry_policy_json),
    failurePolicy: parseJson<ScheduleTask['failurePolicy']>(row.failure_policy_json),
    extra: parseJson<Record<string, unknown>>(row.extra_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    remoteVersion: Number(row.version) || 0,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}
