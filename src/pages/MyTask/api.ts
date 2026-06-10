/**
 * MyTask API 服务层
 *
 * 所有 API 调用遵循项目规范（通过 hostApiFetch），当前使用 mock 数据兜底。
 * 联调时只需：
 *   1. 将 USE_MOCK 改为 false（或由环境变量控制）
 *   2. 替换 API 路径常量中的前缀为真实后端地址
 */

import { hostApiFetch } from '@/lib/host-api';
import type {
  ExecutionRecord,
  ExecutionRecordQuery,
  ExecutionRecordPage,
} from './types';

/** API 路径前缀 — 联调时替换为真实路径 */
const API_PREFIX = '/api/my-tasks';

/** Mock 开关 — 联调时改为 false 或读取 env */
const USE_MOCK = true;

// ──── 执行记录相关 API ────

/**
 * 获取执行记录列表
 * @param query 查询参数（状态、类型、分页等）
 */
export async function fetchExecutionRecords(
  query?: ExecutionRecordQuery,
): Promise<ExecutionRecordPage> {
  if (USE_MOCK) {
    return mockFetchRecords(query);
  }
  const params = new URLSearchParams();
  if (query?.taskId) params.set('task_id', String(query.taskId));
  if (query?.status) params.set('status', query.status);
  if (query?.page) params.set('page', String(query.page));
  if (query?.pageSize) params.set('page_size', String(query.pageSize));
  const qs = params.toString();
  return hostApiFetch<ExecutionRecordPage>(
    `${API_PREFIX}/execution-records${qs ? `?${qs}` : ''}`,
  );
}

// ──── Mock 数据 ──────────────────────────────────────────────

/** Mock 执行记录数据（与 HTML 原型一致：3 running + 4 success + 3 failed） */
const MOCK_RECORDS: ExecutionRecord[] = [
  {
    id: 'rec-001',
    taskId: 1,
    taskName: '每日异常客户跟踪',
    status: 'running',
    taskType: 'workflow',
    workflowName: '异常客户跟踪',
    triggerMethod: '定时触发',
    startTime: '2026-06-05 09:00:00',
    duration: '1 分 05 秒',
    durationMs: 65000,
  },
  {
    id: 'rec-002',
    taskId: 2,
    taskName: '客户成本分析',
    status: 'running',
    taskType: 'workflow',
    workflowName: '发件客户成本分析',
    triggerMethod: '定时触发',
    startTime: '2026-06-05 08:00:00',
    duration: '48 秒',
    durationMs: 48000,
  },
  {
    id: 'rec-003',
    taskId: 3,
    taskName: '测试任务22222',
    status: 'running',
    taskType: 'normal',
    triggerMethod: '定时触发',
    startTime: '2026-06-05 09:00:00',
    duration: '22 秒',
    durationMs: 22000,
  },
  {
    id: 'rec-004',
    taskId: 4,
    taskName: '每日总部对账结果',
    status: 'success',
    taskType: 'workflow',
    workflowName: '总部结算对账',
    triggerMethod: '定时触发',
    startTime: '2026-06-05 08:00:00',
    duration: '42 秒',
    durationMs: 42000,
  },
  {
    id: 'rec-005',
    taskId: 1,
    taskName: '每日异常客户跟踪',
    status: 'success',
    taskType: 'workflow',
    workflowName: '异常客户跟踪',
    triggerMethod: '定时触发',
    startTime: '2026-06-04 09:00:00',
    duration: '38 秒',
    durationMs: 38000,
  },
  {
    id: 'rec-006',
    taskId: 2,
    taskName: '客户成本分析',
    status: 'success',
    taskType: 'workflow',
    workflowName: '发件客户成本分析',
    triggerMethod: '定时触发',
    startTime: '2026-06-01 08:00:00',
    duration: '1 分 12 秒',
    durationMs: 72000,
  },
  {
    id: 'rec-007',
    taskId: 5,
    taskName: '周度库存盘点',
    status: 'success',
    taskType: 'normal',
    triggerMethod: '定时触发',
    startTime: '2026-06-04 18:00:00',
    duration: '15 秒',
    durationMs: 15000,
  },
  {
    id: 'rec-008',
    taskId: 4,
    taskName: '每日总部对账结果',
    status: 'failed',
    taskType: 'workflow',
    workflowName: '总部结算对账',
    triggerMethod: '定时触发',
    startTime: '2026-06-03 08:00:00',
    duration: '5 秒',
    durationMs: 5000,
    failReason: '数据源超时',
  },
  {
    id: 'rec-009',
    taskId: 1,
    taskName: '每日异常客户跟踪',
    status: 'failed',
    taskType: 'workflow',
    workflowName: '异常客户跟踪',
    triggerMethod: '定时触发',
    startTime: '2026-06-02 09:00:00',
    duration: '8 秒',
    durationMs: 8000,
    failReason: '接口鉴权失败',
  },
  {
    id: 'rec-010',
    taskId: 6,
    taskName: '测试任务',
    status: 'failed',
    taskType: 'normal',
    triggerMethod: '定时触发',
    startTime: '2026-06-03 12:00:00',
    duration: '3 秒',
    durationMs: 3000,
    failReason: '脚本异常',
  },
];

/**
 * Mock 执行记录查询
 * 模拟后端分页和筛选逻辑
 */
async function mockFetchRecords(
  query?: ExecutionRecordQuery,
): Promise<ExecutionRecordPage> {
  // 模拟网络延迟
  await new Promise((resolve) => setTimeout(resolve, 200));

  let items = [...MOCK_RECORDS];

  // 按状态筛选
  if (query?.status) {
    items = items.filter((r) => r.status === query.status);
  }
  // 按任务 ID 筛选
  if (query?.taskId) {
    items = items.filter((r) => r.taskId === query.taskId);
  }

  // 分页
  const page = query?.page ?? 1;
  const pageSize = query?.pageSize ?? 20;
  const start = (page - 1) * pageSize;
  const paged = items.slice(start, start + pageSize);

  return {
    items: paged,
    total: items.length,
  };
}
