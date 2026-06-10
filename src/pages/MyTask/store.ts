/**
 * MyTask Zustand Store
 * 管理执行记录数据和页面级筛选状态
 * 定时任务 CRUD 继续消费 useScheduledTasksStore
 */

import { create } from 'zustand';
import { fetchExecutionRecords } from './api';
import type { ExecutionRecord, RecordStatus, TaskType, StatusCounts } from './types';

interface MyTaskState {
  // ── 执行记录数据 ──
  /** 所有执行记录（从 API 获取） */
  records: ExecutionRecord[];
  /** 加载状态 */
  recordsLoading: boolean;
  /** 错误信息 */
  recordsError: string | null;

  // ── 执行记录筛选状态 ──
  /** 当前选中的执行状态 Tab */
  recordStatus: RecordStatus;
  /** 当前选中的任务类型 */
  recordType: TaskType | 'all';
  /** 搜索关键词 */
  recordSearch: string;

  // ── Actions ──
  /** 从 API 拉取执行记录 */
  fetchRecords: () => Promise<void>;
  /** 切换状态 Tab */
  setRecordStatus: (status: RecordStatus) => void;
  /** 切换任务类型筛选 */
  setRecordType: (type: TaskType | 'all') => void;
  /** 设置搜索关键词 */
  setRecordSearch: (q: string) => void;
}

/**
 * 派生：根据 recordType + recordSearch 过滤后的记录列表
 * （不含 status，status 用于 Tab 切换）
 */
export function selectFilteredRecords(state: MyTaskState): ExecutionRecord[] {
  let result = state.records;

  // 按任务类型筛选
  if (state.recordType !== 'all') {
    result = result.filter((r) => r.taskType === state.recordType);
  }

  // 按搜索关键词筛选
  if (state.recordSearch.trim()) {
    const q = state.recordSearch.trim().toLowerCase();
    result = result.filter((r) => r.taskName.toLowerCase().includes(q));
  }

  return result;
}

/**
 * 派生：各状态计数（随 type+search 联动）
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
  recordType: 'all',
  recordSearch: '',

  fetchRecords: async () => {
    set({ recordsLoading: true, recordsError: null });
    try {
      const result = await fetchExecutionRecords();
      set({ records: result.items, recordsLoading: false });
    } catch (err) {
      set({ recordsError: String(err), recordsLoading: false });
    }
  },

  setRecordStatus: (status) => set({ recordStatus: status }),
  setRecordType: (type) => set({ recordType: type }),
  setRecordSearch: (q) => set({ recordSearch: q }),
}));
