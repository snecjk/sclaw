/**
 * MyTask 页面类型定义
 * 包含执行记录、任务视图模型等类型
 */

/** 执行记录状态 */
export type RecordStatus = 'running' | 'success' | 'failed';

/** 一级 Tab：定时任务 / 工作流 */
export type MyTaskSection = 'tasks' | 'workflow';

/** 任务视图：定时任务 / 执行记录（一级「定时任务」内） */
export type TaskView = 'tasks' | 'records';

/** 执行记录（全部为工作流执行记录） */
export interface ExecutionRecord {
  id: string;
  /** 任务名称（即工作流名称） */
  taskName: string;
  /** 执行状态 */
  status: RecordStatus;
  /** 关联工作流名称 */
  workflowName: string;
  /** 执行开始时间（ISO 时间字符串） */
  startTime: string;
  /** 人类可读耗时 */
  duration: string;
  /** 毫秒耗时（便于计算） */
  durationMs: number;
  /** 失败原因（仅 failed 状态） */
  failReason?: string;
}

/** 任务视图模型（基于 ManagedLocalTask 适配卡片展示） */
export interface TaskViewModel {
  id: string;
  /** 任务名称 */
  name: string;
  /** 任务描述 */
  description: string;
  /** cron 表达式 */
  cronExpr: string;
  /** 是否启用 */
  enabled: boolean;
  /** 下次执行时间（ISO 8601，来自接口 nextRunAt，仅展示） */
  nextRunAt: string | null;
  /** 关联工作流：由 extra.composerSegments 派生，不再读 workflow_code 列 */
  hasWorkflow?: boolean;
  /** 关联技能：由 extra.composerSegments 派生 */
  hasSkill?: boolean;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
  /** 关联 Agent ID */
  agentId?: string;
  /** 引擎类型 */
  engineType: 'openclaw' | 'claude';
}

/** 状态计数 */
export interface StatusCounts {
  running: number;
  success: number;
  failed: number;
}
