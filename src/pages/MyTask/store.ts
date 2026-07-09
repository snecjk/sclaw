/**
 * MyTask Zustand Store
 * 管理执行记录数据、页面级筛选状态、工作流选项
 * 执行记录全部来自工作流执行（fetchWorkflowRuns），前端做状态映射与耗时计算
 */

import { create } from 'zustand';
import { fetchWorkflowRuns, fetchWorkflows } from './api';
import type { WorkflowOption, WorkflowRunRecord } from './api';
import type { ExecutionRecord, RecordStatus, StatusCounts } from './types';


// ──── 映射工具 ────

/** 将后端工作流状态映射为前端 RecordStatus；CANCELLED 归为失败，其余归为执行中 */
function mapStatus(raw: string): RecordStatus {
  switch (raw) {
    case 'SUCCEEDED':
      return 'success';
    case 'FAILED':
    case 'CANCELLED':
      return 'failed';
    default:
      return 'running';
  }
}

/** 计算人类可读耗时 */
function calcDuration(startedAt: string, completedAt: string | null): { duration: string; durationMs: number } {
  if (!startedAt) return { duration: '-', durationMs: 0 };
  if (!completedAt) return { duration: '-', durationMs: -1 };
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
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

/** 格式化 ISO 时间为本地化字符串 */
function formatStartTime(iso: string): string {
  if (!iso) return '-';
  return iso.replace('T', ' ').replace(/\.\d+$/, '').slice(0, 19);
}

/** 将后端 WorkflowRunRecord 映射为前端 ExecutionRecord */
function mapToExecutionRecord(run: WorkflowRunRecord): ExecutionRecord {
  const { duration, durationMs } = calcDuration(run.startedAt, run.completedAt);
  return {
    id: run.id,
    taskName: run.workflowName,
    status: mapStatus(run.status),
    workflowName: run.workflowName,
    startTime: formatStartTime(run.startedAt),
    duration,
    durationMs,
    failReason: run.status === 'FAILED' ? (run.error || undefined) : undefined,
  };
}


// ──── Store 定义 ────

/** 单个 Tab 的数据桶 */
interface TabData {
  /** 该状态下的执行记录（映射后，已按时间倒序） */
  items: ExecutionRecord[];
  /** 不限条数的总计数（用于 Tab 角标） */
  total: number;
  /** 该桶加载状态 */
  loading: boolean;
  /** 该桶错误信息 */
  error: string | null;
}

interface MyTaskState {
  // ── 执行记录数据 ──
  /** 按 Tab 分桶存储 */
  recordsByStatus: Record<RecordStatus, TabData>;

  // ── 执行记录筛选状态 ──
  /** 当前选中的执行状态 Tab */
  recordStatus: RecordStatus;
  /** 搜索关键词 */
  recordSearch: string;

  // ── 工作流选项 ──
  /** 工作流下拉选项列表 */
  workflowOptions: WorkflowOption[];

  // ── Actions ──
  /** 从 API 拉取指定 Tab 的工作流执行记录 */
  fetchRecords: (status: RecordStatus) => Promise<void>;
  /** 从 API 拉取工作流列表 */
  fetchWorkflows: () => Promise<void>;
  /** 切换状态 Tab */
  setRecordStatus: (status: RecordStatus) => void;
  /** 设置搜索关键词 */
  setRecordSearch: (q: string) => void;
}

/**
 * 派生：各状态计数（直接取各桶的 total，随后端聚合结果联动）
 */
export function selectRecordCounts(state: MyTaskState): StatusCounts {
  return {
    running: state.recordsByStatus.running.total,
    success: state.recordsByStatus.success.total,
    failed: state.recordsByStatus.failed.total,
  };
}

/**
 * 派生：当前 Tab 状态下的记录列表
 * 取当前桶的 items，按搜索关键词做本地兜底过滤
 */
export function selectCurrentRecords(state: MyTaskState): ExecutionRecord[] {
  const tab = state.recordsByStatus[state.recordStatus];
  if (!state.recordSearch.trim()) return tab.items;
  const q = state.recordSearch.trim().toLowerCase();
  return tab.items.filter((r) => r.taskName.toLowerCase().includes(q));
}

export const useMyTaskStore = create<MyTaskState>((set) => ({
  recordsByStatus: {
    running: { items: [], total: 0, loading: false, error: null },
    success: { items: [], total: 0, loading: false, error: null },
    failed: { items: [], total: 0, loading: false, error: null },
  },

  recordStatus: 'running',
  recordSearch: '',

  workflowOptions: [],

  fetchRecords: async (status) => {
    set((s) => ({
      recordsByStatus: {
        ...s.recordsByStatus,
        [status]: { ...s.recordsByStatus[status], loading: true, error: null },
      },
    }));
    try {
      const { items, total } = await fetchWorkflowRuns({ status, pageSize: 99 });
      set((s) => ({
        recordsByStatus: {
          ...s.recordsByStatus,
          [status]: { items: items.map(mapToExecutionRecord), total, loading: false, error: null },
        },
      }));
    } catch (err) {
      set((s) => ({
        recordsByStatus: {
          ...s.recordsByStatus,
          [status]: { ...s.recordsByStatus[status], loading: false, error: String(err) },
        },
      }));
    }
  },

  fetchWorkflows: async () => {
    try {
      const items = await fetchWorkflows();
      set({ workflowOptions: items });
    } catch (err) {
      console.error('[MyTask] fetchWorkflows failed:', err);
      set({ workflowOptions: [] });
    }
  },

  setRecordStatus: (status) => set({ recordStatus: status }),
  setRecordSearch: (q) => set({ recordSearch: q }),
}));
