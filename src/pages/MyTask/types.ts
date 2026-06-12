/**
 * MyTask 页面类型定义
 * 包含执行记录、任务视图模型等类型
 */

/** 执行记录状态 */
export type RecordStatus = 'running' | 'success' | 'failed';

/** 任务类型：普通任务 / 工作流任务 */
export type TaskType = 'normal' | 'workflow';

/** 任务视图：定时任务 / 执行记录 */
export type TaskView = 'tasks' | 'records';

/** 执行记录 */
export interface ExecutionRecord {
  id: string;
  /** 关联定时任务 ID */
  taskId: number;
  /** 任务名称 */
  taskName: string;
  /** 执行状态 */
  status: RecordStatus;
  /** 任务类型 */
  taskType: TaskType;
  /** 关联工作流名称（仅 workflow 类型） */
  workflowName?: string;
  /** 触发方式：'定时触发' | '手动触发' */
  triggerMethod: string;
  /** 执行开始时间（ISO 时间字符串） */
  startTime: string;
  /** 人类可读耗时 */
  duration: string;
  /** 毫秒耗时（便于计算） */
  durationMs: number;
  /** 失败原因（仅 failed 状态） */
  failReason?: string;
}

/** 执行记录查询参数 */
export interface ExecutionRecordQuery {
  taskId?: number;
  status?: RecordStatus;
  taskName?: string;
  page?: number;
  pageSize?: number;
}

/** 执行记录分页响应 */
export interface ExecutionRecordPage {
  items: ExecutionRecord[];
  total: number;
  page?: number;
  pageSize?: number;
}

/** 任务视图模型（扩展 ScheduledTask 以适配卡片展示） */
export interface TaskViewModel {
  id: string;
  /** 原始数字 ID */
  taskId: number;
  /** 任务名称 */
  name: string;
  /** 任务描述 */
  description: string;
  /** cron 表达式 */
  cronExpr: string;
  /** 是否启用 */
  enabled: boolean;
  /** 非空时显示“工作流任务”标签 */
  workflowName?: string;
  /** 关联工作流 code */
  workflowCode?: string;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
}

/** 推荐任务（空状态展示） */
export interface RecommendTask {
  title: string;
  desc: string;
  schedule: string;
}

/** 状态计数 */
export interface StatusCounts {
  running: number;
  success: number;
  failed: number;
}
