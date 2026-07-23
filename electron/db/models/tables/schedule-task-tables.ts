import type { Generated } from 'kysely';
import type { AgentEngineType } from '../../../engines/types';
import type { NullableTimestampColumn, TimestampColumn } from './session-catalog-tables';

/**
 * 定时任务定义 + 调度状态表（统一存储，取代 jobs.json / definitions.json）。
 * engine_type 区分 openclaw / claude；引擎专属未列字段走 extra_json。
 * 详见 docs/sqlite/schedule-tasks.md
 */
export interface ScheduleTasksTable {
  id: string;
  name: string;
  enabled: number;
  cron_expr: string;
  engine_type: AgentEngineType;
  prompt: string;
  agent_id: string;
  workflow_code: string | null;
  skill_code: string | null;
  dingtalk_recipients_json: string | null;
  model: string | null;
  provider: string | null;
  account_id: string | null;
  workspace_path: string | null;
  permission_profile: string | null;
  timeout_sec: number | null;
  retry_policy_json: string | null;
  failure_policy_json: string | null;
  extra_json: string | null;
  next_run_at: string | null;
  last_scheduled_for: string | null;
  last_recovered_at: string | null;
  cron_expr_snapshot: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
  deleted_at: NullableTimestampColumn;
  version: Generated<number>;
  created_by: string | null;
  updated_by: string | null;
}

/**
 * 定时任务运行记录表（取代两引擎各自 runs/*.jsonl）。
 * 一行 = 一次 run 生命周期状态。idx_schedule_task_runs_idem 保证 (task_id, idempotency_key) 单飞去重。
 */
export interface ScheduleTaskRunsTable {
  run_id: string;
  task_id: string;
  status: string;
  trigger_source: string;
  scheduled_for: string | null;
  started_at: string | null;
  completed_at: string | null;
  attempt: number;
  idempotency_key: string;
  session_key: string | null;
  summary: string | null;
  error: string | null;
  runtime_result_json: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
  deleted_at: NullableTimestampColumn;
  version: Generated<number>;
  created_by: string | null;
  updated_by: string | null;
}
