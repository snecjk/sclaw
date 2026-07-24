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
  ClaudeScheduledTask,
  ClaudeScheduledTaskCreateInput,
  ClaudeScheduledTaskRunRecord,
  ClaudeScheduledTaskUpdateInput,
  TaskTriggerExecutionMeta,
} from '../types/scheduled-task';
import {
  applyCronDeletedTombstones,
  rememberDeletedCronJob,
} from './cron-deleted-tombstones';

export type ManagedLocalTask =
  | ({ engineType: 'openclaw' } & CronJob)
  | ({ engineType: 'claude' } & ClaudeScheduledTask);

interface CronState {
  jobs: ManagedLocalTask[];
  loading: boolean;
  error: string | null;

  // Actions
  fetchJobs: () => Promise<void>;
  createJob: (
    input:
      | { engineType: 'openclaw'; payload: CronJobCreateInput }
      | { engineType: 'claude'; payload: ClaudeScheduledTaskCreateInput },
  ) => Promise<ManagedLocalTask>;
  updateJob: (
    id: string,
    input:
      | { engineType: 'openclaw'; payload: CronJobUpdateInput }
      | { engineType: 'claude'; payload: ClaudeScheduledTaskUpdateInput },
  ) => Promise<void>;
  deleteJob: (id: string, engineType: 'openclaw' | 'claude') => Promise<void>;
  toggleJob: (id: string, enabled: boolean, engineType: 'openclaw' | 'claude') => Promise<void>;
  triggerJob: (id: string, engineType: 'openclaw' | 'claude') => Promise<
    | (CronJob & TaskTriggerExecutionMeta)
    | (ClaudeScheduledTaskRunRecord & TaskTriggerExecutionMeta)
    | TaskTriggerExecutionMeta
    | void
  >;
  setJobs: (jobs: ManagedLocalTask[]) => void;
}

export const useCronStore = create<CronState>((set) => ({
  jobs: [],
  loading: false,
  error: null,

  fetchJobs: async () => {
    set({ loading: true, error: null });
    try {
      const [openclawJobs, claudeTasks] = await Promise.all([
        hostApiFetch<CronJob[]>('/api/cron/jobs').catch(() => []),
        hostApiFetch<ClaudeScheduledTask[]>('/api/claude-scheduled-tasks').catch(() => []),
      ]);
      const jobs = applyCronDeletedTombstones([
        ...openclawJobs.map((job) => ({ ...job, engineType: 'openclaw' as const })),
        ...claudeTasks.map((task) => ({ ...task, engineType: 'claude' as const })),
      ]);
      set({ jobs, loading: false });
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  // Local job operations (Gateway)
  createJob: async (input) => {
    try {
      if (input.engineType === 'claude') {
        const task = await hostApiFetch<ClaudeScheduledTask>('/api/claude-scheduled-tasks', {
          method: 'POST',
          body: JSON.stringify(input.payload),
        });
        const managedTask: ManagedLocalTask = { ...task, engineType: 'claude' };
        set((state) => ({ jobs: [...state.jobs, managedTask] }));
        return managedTask;
      }
      const job = await hostApiFetch<CronJob>('/api/cron/jobs', {
        method: 'POST',
        body: JSON.stringify(input.payload),
      });
      const managedJob: ManagedLocalTask = { ...job, engineType: 'openclaw' };
      set((state) => ({ jobs: [...state.jobs, managedJob] }));
      return managedJob;
    } catch (error) {
      console.error('Failed to create cron job:', error);
      throw error;
    }
  },

  updateJob: async (id, input) => {
    try {
      if (input.engineType === 'claude') {
        const payload = input.payload;
        const body: Record<string, unknown> = {};
        if (payload.name !== undefined) body.name = payload.name;
        if (payload.enabled !== undefined) body.enabled = payload.enabled;
        if (payload.cronExpr !== undefined) body.cronExpr = payload.cronExpr;
        if (payload.promptTemplate !== undefined) body.promptTemplate = payload.promptTemplate;
        if (payload.agentId !== undefined) body.agentId = payload.agentId;
        if (payload.workspacePath !== undefined) body.workspacePath = payload.workspacePath;
        if (payload.providerAccountId !== undefined) body.providerAccountId = payload.providerAccountId;
        if (payload.model !== undefined) body.model = payload.model;
        if (payload.permissionProfile !== undefined) body.permissionProfile = payload.permissionProfile;
        if (payload.timeoutSec !== undefined) body.timeoutSec = payload.timeoutSec;
        if (payload.workflowCode !== undefined) body.workflowCode = payload.workflowCode;
        const updated = await hostApiFetch<ClaudeScheduledTask>(`/api/claude-scheduled-tasks/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        set((state) => ({
          jobs: state.jobs.map((job) =>
            job.id === id && job.engineType === 'claude'
              ? { ...job, ...updated, engineType: 'claude' as const }
              : job
          ),
        }));
        return;
      }
      await hostApiFetch(`/api/cron/jobs/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(input.payload),
      });
      set((state) => ({
        jobs: state.jobs.map((job) =>
          job.id === id && job.engineType === 'openclaw'
            ? { ...job, ...input.payload, updatedAt: new Date().toISOString() }
            : job
        ),
      }));
    } catch (error) {
      console.error('Failed to update cron job:', error);
      throw error;
    }
  },

  deleteJob: async (id, engineType) => {
    try {
      await hostApiFetch(engineType === 'claude'
        ? `/api/claude-scheduled-tasks/${encodeURIComponent(id)}`
        : `/api/cron/jobs/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      rememberDeletedCronJob(id, engineType);
      set((state) => ({
        jobs: state.jobs.filter((job) => !(job.id === id && job.engineType === engineType)),
      }));
    } catch (error) {
      console.error('Failed to delete cron job:', error);
      throw error;
    }
  },

  toggleJob: async (id, enabled, engineType) => {
    try {
      if (engineType === 'claude') {
        await hostApiFetch(`/api/claude-scheduled-tasks/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: JSON.stringify({ enabled }),
        });
      } else {
        await hostApiFetch('/api/cron/toggle', {
          method: 'POST',
          body: JSON.stringify({ id, enabled }),
        });
      }
      set((state) => ({
        jobs: state.jobs.map((job) =>
          job.id === id && job.engineType === engineType ? { ...job, enabled } : job
        ),
      }));
    } catch (error) {
      console.error('Failed to toggle cron job:', error);
      throw error;
    }
  },

  triggerJob: async (id, engineType) => {
    try {
      if (engineType === 'claude') {
        const result = await hostApiFetch<ClaudeScheduledTaskRunRecord & TaskTriggerExecutionMeta>(
          `/api/claude-scheduled-tasks/${encodeURIComponent(id)}/trigger`,
          { method: 'POST' },
        );
        return result;
      }
      const result = await hostApiFetch<TaskTriggerExecutionMeta & Record<string, unknown>>('/api/cron/trigger', {
        method: 'POST',
        body: JSON.stringify({ id }),
      });
      
      // Refresh jobs after trigger to update lastRun/nextRun state
      try {
        const [openclawJobs, claudeTasks] = await Promise.all([
          hostApiFetch<CronJob[]>('/api/cron/jobs').catch(() => []),
          hostApiFetch<ClaudeScheduledTask[]>('/api/claude-scheduled-tasks').catch(() => []),
        ]);
        set({
          jobs: applyCronDeletedTombstones([
            ...openclawJobs.map((job) => ({ ...job, engineType: 'openclaw' as const })),
            ...claudeTasks.map((task) => ({ ...task, engineType: 'claude' as const })),
          ]),
        });
      } catch {
        // Ignore refresh error
      }
      return result;
    } catch (error) {
      console.error('Failed to trigger cron job:', error);
      throw error;
    }
  },

  setJobs: (jobs) => set({ jobs }),
}));
