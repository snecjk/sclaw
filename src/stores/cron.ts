/**
 * Cron State Store
 * Manages scheduled task state for local (Gateway) execution.
 */
import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import type {
  CronJob,
  CronJobCreateInput,
  CronJobUpdateInput,
} from '../types/cron';
import type {
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskUpdateInput,
} from '../types/scheduled-task';

interface CronState {
  jobs: CronJob[];
  loading: boolean;
  error: string | null;
  scheduledTasks: ScheduledTask[];
  scheduledTasksError: string | null;

  // Actions
  fetchJobs: () => Promise<void>;
  fetchScheduledTasks: () => Promise<void>;
  createScheduledTask: (input: ScheduledTaskCreateInput) => Promise<ScheduledTask>;
  updateScheduledTask: (input: ScheduledTaskUpdateInput) => Promise<void>;
  deleteScheduledTask: (taskId: number) => Promise<void>;
  toggleScheduledTask: (taskId: number, enabled: boolean) => Promise<void>;
  triggerScheduledTask: (taskId: number) => Promise<void>;
  createJob: (input: CronJobCreateInput) => Promise<CronJob>;
  updateJob: (id: string, input: CronJobUpdateInput) => Promise<void>;
  deleteJob: (id: string) => Promise<void>;
  toggleJob: (id: string, enabled: boolean) => Promise<void>;
  triggerJob: (id: string) => Promise<void>;
  setJobs: (jobs: CronJob[]) => void;
}

export const useCronStore = create<CronState>((set) => ({
  jobs: [],
  loading: false,
  error: null,
  scheduledTasks: [],
  scheduledTasksError: null,

  fetchJobs: async () => {
    set({ loading: true, error: null });
    try {
      const jobs = await hostApiFetch<CronJob[]>('/api/cron/jobs');
      set({ jobs, loading: false });
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  fetchScheduledTasks: async () => {
    set({ loading: true, scheduledTasksError: null });
    try {
      const tasks = await hostApiFetch<ScheduledTask[]>('/api/scheduled-tasks');
      set({ scheduledTasks: tasks, loading: false });
    } catch (error) {
      console.error('Failed to fetch scheduled tasks:', error);
      set({ scheduledTasksError: String(error), loading: false });
      throw error;
    }
  },

  createScheduledTask: async (input) => {
    try {
      const task = await hostApiFetch<ScheduledTask>('/api/scheduled-tasks', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      set((state) => ({ scheduledTasks: [...state.scheduledTasks, task] }));
      return task;
    } catch (error) {
      console.error('Failed to create scheduled task:', error);
      throw error;
    }
  },

  updateScheduledTask: async (input) => {
    try {
      const body: Record<string, unknown> = {};
      if (input.name !== undefined) body.name = input.name;
      if (input.cronExpr !== undefined) body.cronExpr = input.cronExpr;
      if (input.description !== undefined) body.description = input.description;
      if (input.notifyMode !== undefined) body.notifyMode = input.notifyMode;
      if (input.enabled !== undefined) body.enabled = input.enabled;

      const updated = await hostApiFetch<ScheduledTask>(`/api/scheduled-tasks/${input.taskId}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      set((state) => ({
        scheduledTasks: state.scheduledTasks.map((t) =>
          t.id === input.taskId ? updated : t
        ),
      }));
    } catch (error) {
      const message = String(error);
      if (message.includes('404') || message.includes('TASK_NOT_FOUND')) {
        set((state) => ({
          scheduledTasks: state.scheduledTasks.filter((t) => t.id !== input.taskId),
        }));
      }
      console.error('Failed to update scheduled task:', error);
      throw error;
    }
  },

  deleteScheduledTask: async (taskId) => {
    try {
      await hostApiFetch(`/api/scheduled-tasks/${taskId}`, {
        method: 'DELETE',
      });
      set((state) => ({
        scheduledTasks: state.scheduledTasks.filter((t) => t.id !== taskId),
      }));
    } catch (error) {
      console.error('Failed to delete scheduled task:', error);
      throw error;
    }
  },

  toggleScheduledTask: async (taskId, enabled) => {
    try {
      await hostApiFetch(`/api/scheduled-tasks/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      });
      set((state) => ({
        scheduledTasks: state.scheduledTasks.map((t) =>
          t.id === taskId ? { ...t, enabled } : t
        ),
      }));
    } catch (error) {
      console.error('Failed to toggle scheduled task:', error);
      throw error;
    }
  },

  triggerScheduledTask: async (taskId) => {
    try {
      const result = await hostApiFetch<{ runId: number; outcome: string }>(`/api/scheduled-tasks/${taskId}/trigger`, {
        method: 'POST',
      });
      console.log('Scheduled task trigger result:', result);
    } catch (error) {
      console.error('Failed to trigger scheduled task:', error);
      throw error;
    }
  },

  // Local job operations (Gateway)
  createJob: async (input) => {
    try {
      const job = await hostApiFetch<CronJob>('/api/cron/jobs', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      set((state) => ({ jobs: [...state.jobs, job] }));
      return job;
    } catch (error) {
      console.error('Failed to create cron job:', error);
      throw error;
    }
  },

  updateJob: async (id, input) => {
    try {
      await hostApiFetch(`/api/cron/jobs/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      });
      set((state) => ({
        jobs: state.jobs.map((job) =>
          job.id === id ? { ...job, ...input, updatedAt: new Date().toISOString() } : job
        ),
      }));
    } catch (error) {
      console.error('Failed to update cron job:', error);
      throw error;
    }
  },

  deleteJob: async (id) => {
    try {
      await hostApiFetch(`/api/cron/jobs/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      set((state) => ({
        jobs: state.jobs.filter((job) => job.id !== id),
      }));
    } catch (error) {
      console.error('Failed to delete cron job:', error);
      throw error;
    }
  },

  toggleJob: async (id, enabled) => {
    try {
      await hostApiFetch('/api/cron/toggle', {
        method: 'POST',
        body: JSON.stringify({ id, enabled }),
      });
      set((state) => ({
        jobs: state.jobs.map((job) =>
          job.id === id ? { ...job, enabled } : job
        ),
      }));
    } catch (error) {
      console.error('Failed to toggle cron job:', error);
      throw error;
    }
  },

  triggerJob: async (id) => {
    try {
      const result = await hostApiFetch('/api/cron/trigger', {
        method: 'POST',
        body: JSON.stringify({ id }),
      });
      console.log('Cron trigger result:', result);
      // Refresh jobs after trigger to update lastRun/nextRun state
      try {
        const jobs = await hostApiFetch<CronJob[]>('/api/cron/jobs');
        set({ jobs });
      } catch {
        // Ignore refresh error
      }
    } catch (error) {
      console.error('Failed to trigger cron job:', error);
      throw error;
    }
  },

  setJobs: (jobs) => set({ jobs }),
}));

export type { ScheduledTask, ScheduledTaskCreateInput, ScheduledTaskUpdateInput };
