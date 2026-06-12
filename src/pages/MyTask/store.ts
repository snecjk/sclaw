/**
 * MyTask Zustand Store
 * 管理执行记录数据和页面级筛选状态
 * 后端已支持 status/task_id/task_name 分页过滤，前端仅保留 keyword 本地搜索和 taskType 筛选
 */

import { create } from 'zustand';
import { fetchExecutionRecords } from './api';
import type { ExecutionRecord, TaskType } from './types';

interface MyTaskState {
  // ── 执行记录数据 ──
  /** 当前页的执行记录（后端分页返回） */
  records: ExecutionRecord[];
  /** 加载状态 */
  recordsLoading: boolean;
  /** 错误信息 */
  recordsError: string | null;

  // ── 分页状态 ──
  /** 当前页码 */
  recordPage: number;
  /** 每页条数 */
  recordPageSize: number;
  /** 总记录数 */
  recordTotal: number;

  // ── 执行记录筛选状态 ──
  /** 当前选中的任务类型 */
  recordType: TaskType | 'all';
  /** 搜索关键词 */
  recordSearch: string;

  // ── Actions ──
  /** 从 API 拉取执行记录（支持分页） */
  fetchRecords: (params?: { page?: number; pageSize?: number }) => Promise<void>;
  /** 切换任务类型筛选 */
  setRecordType: (type: TaskType | 'all') => void;
  /** 设置搜索关键词 */
  setRecordSearch: (q: string) => void;
  /** 跳转到指定页 */
  setRecordPage: (page: number) => void;
}

/**
 * 派生：根据 recordType + recordSearch 过滤后的记录列表
 */
export function selectFilteredRecords(state: MyTaskState): ExecutionRecord[] {
  let result = state.records;

  // 按任务类型筛选（本地）
  if (state.recordType !== 'all') {
    result = result.filter((r) => r.taskType === state.recordType);
  }

  // 按搜索关键词筛选（本地兜底）
  if (state.recordSearch.trim()) {
    const q = state.recordSearch.trim().toLowerCase();
    result = result.filter((r) => r.taskName.toLowerCase().includes(q));
  }

  return result;
}

/**
 * 派生：当前记录列表
 */
export function selectCurrentRecords(state: MyTaskState): ExecutionRecord[] {
  return selectFilteredRecords(state);
}

export const useMyTaskStore = create<MyTaskState>((set, get) => ({
  records: [],
  recordsLoading: false,
  recordsError: null,

  recordPage: 1,
  recordPageSize: 100,
  recordTotal: 0,

  recordType: 'all',
  recordSearch: '',

  fetchRecords: async (params) => {
    const state = get();
    const page = params?.page ?? state.recordPage;
    const pageSize = params?.pageSize ?? state.recordPageSize;

    set({ recordsLoading: true, recordsError: null });
    try {
      const result = await fetchExecutionRecords({
        page,
        pageSize,
      });
      set({
        records: result.items,
        recordsLoading: false,
        recordTotal: result.total,
        recordPage: page,
        recordPageSize: pageSize,
      });
    } catch (err) {
      set({ recordsError: String(err), recordsLoading: false });
    }
  },

  setRecordType: (type) => set({ recordType: type }),
  setRecordSearch: (q) => set({ recordSearch: q }),
  setRecordPage: (page) => {
    set({ recordPage: page });
    get().fetchRecords({ page });
  },
}));
