/**
 * Scheduled Task Store
 * 管理统一 ScheduleTask（openclaw + claude 两引擎合一，自带 engineType）。
 * 全部 hit /api/scheduled-tasks/*。
 */
import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import type {
  ScheduleTask,
  CreateScheduleTaskInput,
  UpdateScheduleTaskInput,
  ScheduleTaskRunRecord,
  TaskTriggerExecutionMeta,
} from '../types/scheduled-task';

/** @deprecated 旧名，新代码直接用 ScheduleTask。 */
export type ManagedLocalTask = ScheduleTask;

interface CronState {
  jobs: ScheduleTask[];
  loading: boolean;
  error: string | null;
  /** 传给 Sidebar `useScheduledTaskNameMaps` 的 refreshKey 增量；改名后 +1。 */
  nameMapsRefreshKey: number;

  fetchJobs: () => Promise<void>;
  createJob: (input: CreateScheduleTaskInput) => Promise<ScheduleTask>;
  updateJob: (id: string, input: UpdateScheduleTaskInput) => Promise<void>;
  deleteJob: (id: string) => Promise<void>;
  toggleJob: (id: string, enabled: boolean) => Promise<void>;
  triggerJob: (id: string) => Promise<(ScheduleTaskRunRecord & TaskTriggerExecutionMeta) | void>;
  setJobs: (jobs: ScheduleTask[]) => void;
  bumpNameMapsRefreshKey: () => void;
}

export const useCronStore = create<CronState>((set) => ({
  jobs: [],
  loading: false,
  error: null,
  nameMapsRefreshKey: 0,

  fetchJobs: async () => {
    set({ loading: true, error: null });
    try {
      const jobs = await hostApiFetch<ScheduleTask[]>('/api/scheduled-tasks').catch(
        () => [] as ScheduleTask[],
      );
      set({ jobs, loading: false });
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  createJob: async (input) => {
    try {
      const task = await hostApiFetch<ScheduleTask>('/api/scheduled-tasks', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      set((state) => ({ jobs: [...state.jobs, task] }));
      return task;
    } catch (error) {
      console.error('Failed to create scheduled task:', error);
      throw error;
    }
  },

  updateJob: async (id, input) => {
    try {
      const updated = await hostApiFetch<ScheduleTask>(
        `/api/scheduled-tasks/${encodeURIComponent(id)}`,
        {
          method: 'PUT',
          body: JSON.stringify(input),
        },
      );
      set((state) => ({
        jobs: state.jobs.map((job) => (job.id === id ? { ...job, ...updated } : job)),
      }));
    } catch (error) {
      console.error('Failed to update scheduled task:', error);
      throw error;
    }
  },

  deleteJob: async (id) => {
    try {
      await hostApiFetch(`/api/scheduled-tasks/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      set((state) => ({ jobs: state.jobs.filter((job) => job.id !== id) }));
    } catch (error) {
      console.error('Failed to delete scheduled task:', error);
      throw error;
    }
  },

  toggleJob: async (id, enabled) => {
    try {
      await hostApiFetch(`/api/scheduled-tasks/${encodeURIComponent(id)}/set-enabled`, {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      });
      set((state) => ({
        jobs: state.jobs.map((job) => (job.id === id ? { ...job, enabled } : job)),
      }));
    } catch (error) {
      console.error('Failed to toggle scheduled task:', error);
      throw error;
    }
  },

  triggerJob: async (id) => {
    try {
      const result = await hostApiFetch<ScheduleTaskRunRecord & TaskTriggerExecutionMeta>(
        `/api/scheduled-tasks/${encodeURIComponent(id)}/trigger`,
        { method: 'POST' },
      );
      // 刷新任务列表以更新 lastRun/nextRun 状态
      try {
        const jobs = await hostApiFetch<ScheduleTask[]>('/api/scheduled-tasks').catch(
          () => [] as ScheduleTask[],
        );
        set({ jobs });
      } catch {
        // 忽略刷新错误
      }
      return result;
    } catch (error) {
      console.error('Failed to trigger scheduled task:', error);
      throw error;
    }
  },

  setJobs: (jobs) => set({ jobs }),

  bumpNameMapsRefreshKey: () =>
    set((state) => ({ nameMapsRefreshKey: state.nameMapsRefreshKey + 1 })),
}));
