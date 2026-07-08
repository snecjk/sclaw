/**
 * MyTask API 服务层
 *
 * 前端直接写死完整路径 /api/my-tasks/agent/v1/xxx，
 * Electron 截取 /api/my-tasks 后面部分转发至 Python 后端。
 *
 * 例：/api/my-tasks/agent/v1/my-workflow → 后端 /agent/v1/my-workflow
 */

import { hostApiFetch } from '@/lib/host-api';


// ──── 工作流相关 API ────

export interface WorkflowOption {
  value: string;
  label: string;
  description?: string;
}

/**
 * 获取工作流列表（不分页）
 */
export async function fetchWorkflows(): Promise<WorkflowOption[]> {
  const res = await hostApiFetch<{
    success: boolean;
    data: Array<{ id: string; name: string; description?: string; templateId?: string }>;
  }>(
    '/api/my-tasks/agent/v1/my-workflow',
    { method: 'GET' },
  );
  const items = (res?.data ?? []).map((w) => ({
    value: w.id,
    label: w.name,
    description: w.description ?? '',
  }));
  return items;
}


// ──── 执行记录相关 API ────

/** 后端返回的工作流执行记录 */
export interface WorkflowRunRecord {
  /** run_id */
  id: string;
  /** workflow 业务 ID */
  workflowId: string;
  /** 工作流名称（后端 join 返回） */
  workflowName: string;
  /** RUNNING/SUCCEEDED/FAILED 等 */
  status: string;
  /** ISO 时间 */
  startedAt: string;
  completedAt: string | null;
  error: string | null;
}

/** 工作流执行记录分页响应 */
export interface WorkflowRunsResponse {
  success: boolean;
  data: WorkflowRunRecord[];
  total: number;
  page: number;
  pageSize: number;
  traceId?: string;
}

/**
 * 获取工作流执行记录（按 Tab 状态聚合 + 分页）
 *
 * status 为 Tab 级固定值（running/success/failed），后端聚合到底层枚举后过滤；
 * 不传则返回全部状态。返回 { items, total }，total 为不限条数的总计数。
 */
export async function fetchWorkflowRuns(
  params?: { status?: string; keyword?: string; pageSize?: number },
): Promise<{ items: WorkflowRunRecord[]; total: number }> {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.keyword) query.set('keyword', params.keyword);
  query.set('pageSize', String(params?.pageSize ?? 99));
  const qs = query.toString();
  const url = `/api/my-tasks/agent/v1/my-workflow-runs${qs ? `?${qs}` : ''}`;
  const res = await hostApiFetch<WorkflowRunsResponse>(url, { method: 'GET' });
  return { items: res?.data ?? [], total: res?.total ?? 0 };
}
