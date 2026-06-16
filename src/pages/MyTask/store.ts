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

/** 将后端工作流状态映射为前端 RecordStatus */
function mapStatus(raw: string): RecordStatus {
  switch (raw) {
    case 'SUCCEEDED':
      return 'success';
    case 'FAILED':
      return 'failed';
    case 'RUNNING':
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

interface MyTaskState {
  // ── 执行记录数据 ──
  /** 当前的执行记录（映射后） */
  records: ExecutionRecord[];
  /** 加载状态 */
  recordsLoading: boolean;
  /** 错误信息 */
  recordsError: string | null;

  // ── 执行记录筛选状态 ──
  /** 当前选中的执行状态 Tab */
  recordStatus: RecordStatus;
  /** 搜索关键词 */
  recordSearch: string;

  // ── 工作流选项 ──
  /** 工作流下拉选项列表 */
  workflowOptions: WorkflowOption[];

  // ── Actions ──
  /** 从 API 拉取工作流执行记录 */
  fetchRecords: () => Promise<void>;
  /** 从 API 拉取工作流列表 */
  fetchWorkflows: () => Promise<void>;
  /** 切换状态 Tab */
  setRecordStatus: (status: RecordStatus) => void;
  /** 设置搜索关键词 */
  setRecordSearch: (q: string) => void;
}

/**
 * 派生：按 recordSearch 过滤后的记录列表
 */
export function selectFilteredRecords(state: MyTaskState): ExecutionRecord[] {
  let result = state.records;

  // 按搜索关键词筛选（本地兜底）
  if (state.recordSearch.trim()) {
    const q = state.recordSearch.trim().toLowerCase();
    result = result.filter((r) => r.taskName.toLowerCase().includes(q));
  }

  return result;
}

/**
 * 派生：各状态计数（随 search 联动）
 * 用于 RecordStatusNav 显示各状态的数量
 */
export function selectRecordCounts(state: MyTaskState): StatusCounts {
  const filtered = selectFilteredRecords(state);
  const counts: StatusCounts = { running: 0, success: 0, failed: 0 };
  for (const r of filtered) {
    counts[r.status]++;
  }
  return counts;
}

/**
 * 派生：当前 Tab 状态下的记录列表
 * 在 filteredRecords 基础上再按 status 过滤
 */
export function selectCurrentRecords(state: MyTaskState): ExecutionRecord[] {
  const filtered = selectFilteredRecords(state);
  return filtered.filter((r) => r.status === state.recordStatus);
}

export const useMyTaskStore = create<MyTaskState>((set) => ({
  records: [],
  recordsLoading: false,
  recordsError: null,

  recordStatus: 'running',
  recordSearch: '',

  workflowOptions: [],

  fetchRecords: async () => {
    set({ recordsLoading: true, recordsError: null });
    try {
      const runs = await fetchWorkflowRuns();
      set({
        records: runs.map(mapToExecutionRecord),
        recordsLoading: false,
      });
    } catch (err) {
      set({ recordsError: String(err), recordsLoading: false });
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
