/**
 * Cron State Store
 * Manages scheduled task state for both local (Gateway) and cloud execution.
 */
import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import type {
  CronJob,
  CronJobCreateInput,
  CronJobUpdateInput,
  CloudCronJob,
  CloudAgentRef,
  CloudTaskResult,
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskUpdateInput,
} from '../types/cron';

interface CronState {
  jobs: CronJob[];
  cloudJobs: CloudCronJob[];
  cloudAgents: CloudAgentRef[];
  loading: boolean;
  error: string | null;
  cloudError: string | null;
  lastSyncAt: string | null;
  scheduledTasks: ScheduledTask[];
  scheduledTasksError: string | null;

  // Actions
  fetchJobs: () => Promise<void>;
  fetchCloudAgents: () => Promise<void>;
  fetchScheduledTasks: () => Promise<void>;
  createScheduledTask: (input: ScheduledTaskCreateInput) => Promise<ScheduledTask>;
  updateScheduledTask: (input: ScheduledTaskUpdateInput) => Promise<void>;
  deleteScheduledTask: (taskId: number) => Promise<void>;
  toggleScheduledTask: (taskId: number, enabled: boolean) => Promise<void>;
  triggerScheduledTask: (taskId: number) => Promise<void>;
  createJob: (input: CronJobCreateInput) => Promise<CronJob>;
  createCloudJob: (input: { name: string; message: string; schedule: string; agentId: string; enabled?: boolean }) => Promise<CloudCronJob>;
  updateJob: (id: string, input: CronJobUpdateInput) => Promise<void>;
  updateCloudJob: (id: string, input: { name?: string; message?: string; schedule?: string; agentId?: string; enabled?: boolean }) => Promise<void>;
  deleteJob: (id: string) => Promise<void>;
  deleteCloudJob: (id: string) => Promise<void>;
  toggleJob: (id: string, enabled: boolean) => Promise<void>;
  toggleCloudJob: (id: string, enabled: boolean) => Promise<void>;
  triggerJob: (id: string) => Promise<void>;
  triggerCloudJob: (id: string) => Promise<void>;
  syncCloudResults: () => Promise<CloudTaskResult[]>;
  setJobs: (jobs: CronJob[]) => void;
}

export const useCronStore = create<CronState>((set, get) => ({
  jobs: [],
  cloudJobs: [],
  cloudAgents: [],
  loading: false,
  error: null,
  cloudError: null,
  lastSyncAt: null,
  scheduledTasks: [],
  scheduledTasksError: null,

  fetchJobs: async () => {
    set({ loading: true, error: null, cloudError: null });

    try {
      // Fetch local jobs from Gateway
      let localJobs: CronJob[] = [];
      try {
        localJobs = await hostApiFetch<CronJob[]>('/api/cron/jobs');
      } catch (localErr) {
        console.error('Failed to fetch local cron jobs:', localErr);
        // Continue with cloud jobs even if local fails
      }

      // Fetch cloud jobs from external service
      let cloudJobs: CloudCronJob[] = [];
      try {
        cloudJobs = await hostApiFetch<CloudCronJob[]>('/api/cron/cloud/jobs');
      } catch (cloudErr) {
        console.error('Failed to fetch cloud cron jobs:', cloudErr);
        set({ cloudError: String(cloudErr) });
        // Use cached cloud jobs if available
        cloudJobs = get().cloudJobs;
      }

      set({
        jobs: localJobs,
        cloudJobs,
        loading: false,
      });
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

  fetchCloudAgents: async () => {
    try {
      const agents = await hostApiFetch<CloudAgentRef[]>('/api/cron/cloud/agents');
      set({ cloudAgents: agents });
    } catch (error) {
      console.error('Failed to fetch cloud agents:', error);
      set({ cloudError: String(error) });
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

  // Cloud job operations
  createCloudJob: async (input) => {
    try {
      const job = await hostApiFetch<CloudCronJob>('/api/cron/cloud/jobs', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      set((state) => ({ cloudJobs: [...state.cloudJobs, job] }));
      return job;
    } catch (error) {
      console.error('Failed to create cloud cron job:', error);
      throw error;
    }
  },

  updateCloudJob: async (id, input) => {
    try {
      const updated = await hostApiFetch<CloudCronJob>(`/api/cron/cloud/jobs/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      });
      set((state) => ({
        cloudJobs: state.cloudJobs.map((job) =>
          job.id === id ? { ...job, ...updated } : job
        ),
      }));
    } catch (error) {
      const message = String(error);
      if (message.includes('TASK_NOT_FOUND') || message.includes('404')) {
        // Remove stale task from local cache
        set((state) => ({
          cloudJobs: state.cloudJobs.filter((job) => job.id !== id),
        }));
      }
      console.error('Failed to update cloud cron job:', error);
      throw error;
    }
  },

  deleteCloudJob: async (id) => {
    try {
      await hostApiFetch(`/api/cron/cloud/jobs/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      set((state) => ({
        cloudJobs: state.cloudJobs.filter((job) => job.id !== id),
      }));
    } catch (error) {
      console.error('Failed to delete cloud cron job:', error);
      throw error;
    }
  },

  toggleCloudJob: async (id, enabled) => {
    try {
      await hostApiFetch('/api/cron/cloud/toggle', {
        method: 'POST',
        body: JSON.stringify({ id, enabled }),
      });
      set((state) => ({
        cloudJobs: state.cloudJobs.map((job) =>
          job.id === id ? { ...job, enabled } : job
        ),
      }));
    } catch (error) {
      console.error('Failed to toggle cloud cron job:', error);
      throw error;
    }
  },

  triggerCloudJob: async (id) => {
    try {
      const result = await hostApiFetch<{ runId: string; status: string }>('/api/cron/cloud/trigger', {
        method: 'POST',
        body: JSON.stringify({ id }),
      });
      console.log('Cloud cron trigger result:', result);
    } catch (error) {
      console.error('Failed to trigger cloud cron job:', error);
      throw error;
    }
  },

  // Result sync
  syncCloudResults: async () => {
    const state = get();
    const since = state.lastSyncAt ?? new Date(0).toISOString();

    try {
      const response = await hostApiFetch<{
        results: CloudTaskResult[];
        nextCursor?: string;
        hasMore: boolean;
      }>(`/api/cron/cloud/results?since=${encodeURIComponent(since)}&limit=50`);

      const newResults = response.results ?? [];

      if (newResults.length > 0) {
        // Update lastSyncAt to the latest result's completedAt
        const latestCompletedAt = newResults
          .map((r) => r.completedAt)
          .sort()
          .pop();
        if (latestCompletedAt) {
          set({ lastSyncAt: latestCompletedAt });
        }
      }

      // Persist results to local cache via Main-process
      if (newResults.length > 0) {
        try {
          await hostApiFetch('/api/cron/cloud/results/sync', {
            method: 'POST',
            body: JSON.stringify({ results: newResults }),
          });
        } catch (cacheErr) {
          console.error('Failed to cache cloud results:', cacheErr);
        }
      }

      return newResults;
    } catch (error) {
      console.error('Failed to sync cloud results:', error);
      return [];
    }
  },

  setJobs: (jobs) => set({ jobs }),
}));

export type { ScheduledTask, ScheduledTaskCreateInput, ScheduledTaskUpdateInput };
