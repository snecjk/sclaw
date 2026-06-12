/**
 * MyTask API 服务层
 *
 * 通过 hostApiFetch 调用后端 /agent/v1/scheduled-tasks/runs/page 分页接口。
 * Node 代理自动透传：/api/my-tasks/scheduled-tasks/runs/page → /agent/v1/scheduled-tasks/runs/page
 */

import { hostApiFetch } from '@/lib/host-api';
import type {
  ExecutionRecord,
  ExecutionRecordQuery,
  ExecutionRecordPage,
  RecordStatus,
  TaskType,
} from './types';

/** API 路径前缀 */
const API_PREFIX = '/api/my-tasks';


// ──── 后端响应类型 ────

interface BackendTaskRun {
  id: number;
  task_id: number;
  owner_user_id: string;
  status: string;
  exit_code: number | null;
  log_text: string | null;
  execution_result: string | null;
  started_at: string | null;
  finished_at: string | null;
  notify_dingtalk_ok: boolean | null;
  notify_dialog_ok: boolean | null;
  extra_info: Record<string, unknown> | null;
  created_at: string | null;
}

interface BackendTaskRunPageResponse {
  success: boolean;
  data: {
    items: BackendTaskRun[];
    total: number;
    page: number;
    page_size: number;
  };
  total?: number;
}

// ──── 字段映射工具 ────

/** 计算人类可读耗时 */
function formatDuration(
  startedAt: string | null,
  finishedAt: string | null,
): { duration: string; durationMs: number } {
  if (!startedAt) return { duration: '-', durationMs: 0 };
  if (!finishedAt) return { duration: '-', durationMs: -1 };
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 0) return { duration: '-', durationMs: 0 };
  if (ms === 0) return { duration: '< 1 秒', durationMs: 0 };
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  if (minutes > 0) {
    return {
      duration: `${minutes} 分 ${remainSeconds.toString().padStart(2, '0')} 秒`,
      durationMs: ms,
    };
  }
  return { duration: `${seconds} 秒`, durationMs: ms };
}

/** 格式化时间为本地化字符串 */
function formatTime(iso: string | null): string {
  if (!iso) return '-';
  return iso.replace('T', ' ').replace(/\.\d+$/, '').slice(0, 19);
}

/** 将后端 TaskRun 映射为前端 ExecutionRecord */
function mapToExecutionRecord(run: BackendTaskRun): ExecutionRecord {
  const extra = run.extra_info || {};
  const taskName = (extra.task_name as string) || `任务 #${run.task_id}`;
  const workflowName = (extra.workflow_name as string) || undefined;
  const taskType: TaskType = (extra.workflow_code as string) ? 'workflow' : 'normal';
  const { duration, durationMs } = formatDuration(run.started_at, run.finished_at);

  return {
    id: String(run.id),
    taskId: run.task_id,
    taskName,
    status: run.status as RecordStatus,
    taskType,
    workflowName,
    triggerMethod: '定时触发',
    startTime: formatTime(run.started_at || run.created_at),
    duration,
    durationMs,
    failReason: run.status === 'failed' ? (run.log_text || undefined) : undefined,
  };
}

// ──── 执行记录相关 API ────

/**
 * 获取执行记录列表（真实后端接口）
 * @param query 查询参数（状态、类型、分页等）
 */
export async function fetchExecutionRecords(
  query?: ExecutionRecordQuery,
): Promise<ExecutionRecordPage> {
  const body: Record<string, unknown> = {
    page: query?.page ?? 1,
    page_size: query?.pageSize ?? 100,
  };
  if (query?.status) body.status = query.status;
  if (query?.taskId) body.task_id = query.taskId;
  if (query?.taskName) body.task_name = query.taskName;

  const response = await hostApiFetch<BackendTaskRunPageResponse>(
    `${API_PREFIX}/scheduled-tasks/runs/page`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  // 兼容 hostApiFetch 可能返回完整响应体或已解包 data 两种格式
  const data = (response as any).data ?? (response as any);
  return {
    items: (data.items as BackendTaskRun[]).map(mapToExecutionRecord),
    total: data.total as number,
    page: data.page as number,
    pageSize: data.page_size as number,
  };
}
