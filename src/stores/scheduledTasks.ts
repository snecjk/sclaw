/**
 * Scheduled Tasks Store
 * Independent store for the new /scheduled-tasks page.
 * Does NOT mix with the legacy local cron store.
 */
import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import type {
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskUpdateInput,
  ScheduledTaskTriggerResponse,
} from '@/types/scheduled-task';

export interface WorkflowOption {
  value: string;
  label: string;
  description?: string;
}

interface ScheduledTasksState {
  tasks: ScheduledTask[];
  workflowOptions: WorkflowOption[];
  loading: boolean;
  error: string | null;

  fetchTasks: () => Promise<void>;
  fetchWorkflows: () => Promise<void>;
  createTask: (input: ScheduledTaskCreateInput) => Promise<ScheduledTask>;
  updateTask: (input: ScheduledTaskUpdateInput) => Promise<void>;
  deleteTask: (taskId: number) => Promise<void>;
  toggleTask: (taskId: number, enabled: boolean) => Promise<void>;
  triggerTask: (taskId: number, extraInfo?: Record<string, unknown>) => Promise<ScheduledTaskTriggerResponse>;
}

export const useScheduledTasksStore = create<ScheduledTasksState>((set) => ({
  tasks: [],
  workflowOptions: [],
  loading: false,
  error: null,

  fetchTasks: async () => {
    set({ loading: true, error: null });
    try {
      const tasks = await hostApiFetch<ScheduledTask[]>('/api/scheduled-tasks');
      set({ tasks, loading: false });
    } catch (err) {
      const message = String(err);
      set({ error: message, loading: false });
      throw err;
    }
  },

  fetchWorkflows: async () => {
    try {
      const res = await hostApiFetch<{ success: boolean; data: Array<{ id: string; name: string; description?: string }> }>(
        '/api/my-tasks/workflows/page',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ page: 1, pageSize: 100 }),
        },
      );
      const items = (res?.data ?? []).map((w) => ({ value: w.id, label: w.name, description: w.description ?? '' }));
      set({ workflowOptions: items });
    } catch (err) {
      console.error('[scheduledTasks] fetchWorkflows failed:', err);
      set({ workflowOptions: [] });
    }
  },

  createTask: async (input) => {
    const task = await hostApiFetch<ScheduledTask>('/api/scheduled-tasks', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    set((state) => ({ tasks: [...state.tasks, task] }));
    return task;
  },

  updateTask: async (input) => {
    const body: Record<string, unknown> = {};
    if (input.name !== undefined) body.name = input.name;
    if (input.cronExpr !== undefined) body.cronExpr = input.cronExpr;
    if (input.description !== undefined) body.description = input.description;
    if (input.notifyMode !== undefined) body.notifyMode = input.notifyMode;
    if (input.dingdingId !== undefined) body.dingdingId = input.dingdingId;
    if (input.dingdingGroupId !== undefined) body.dingdingGroupId = input.dingdingGroupId;
    if (input.dingdingGroupName !== undefined) body.dingdingGroupName = input.dingdingGroupName;
    if (input.enabled !== undefined) body.enabled = input.enabled;
    if (input.workflowCode !== undefined) body.workflowCode = input.workflowCode;

    const updated = await hostApiFetch<ScheduledTask>(`/api/scheduled-tasks/${input.taskId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === input.taskId ? updated : t)),
    }));
  },

  deleteTask: async (taskId) => {
    await hostApiFetch(`/api/scheduled-tasks/${taskId}`, {
      method: 'DELETE',
    });
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== taskId),
    }));
  },

  toggleTask: async (taskId, enabled) => {
    await hostApiFetch(`/api/scheduled-tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, enabled } : t)),
    }));
  },

  triggerTask: async (taskId, extraInfo) => {
    const body: Record<string, unknown> = {};
    if (extraInfo !== undefined) {
      body.extraInfo = extraInfo;
    }
    const result = await hostApiFetch<ScheduledTaskTriggerResponse>(
      `/api/scheduled-tasks/${taskId}/trigger`,
      {
        method: 'POST',
        ...(Object.keys(body).length > 0 ? { body: JSON.stringify(body) } : {}),
      },
    );
    console.log('Scheduled task trigger result:', result);
    return result;
  },
}));
