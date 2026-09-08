import { PORTS } from '../../../utils/config';
import type {
  CreateScheduleTaskInput,
  UpdateScheduleTaskInput,
} from '../../../db/models/dto/schedule-task.dto';
import type {
  ScheduleTask,
  ScheduleTaskRun,
} from '../../../db/models/domain/schedule-task';
import type { StoScheduledTaskPort } from './capability';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${PORTS.CLAWX_HOST_API}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => undefined) as T | { error?: unknown } | undefined;
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload
      ? String(payload.error)
      : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return payload as T;
}

export function createHostApiScheduledTaskPort(): StoScheduledTaskPort {
  return {
    resolveDefaults: (sessionKey: string) => request(
      `/api/scheduled-tasks/context?sessionKey=${encodeURIComponent(sessionKey)}`,
    ),
    list: () => request<ScheduleTask[]>('/api/scheduled-tasks'),
    create: (input: CreateScheduleTaskInput) => request<ScheduleTask>('/api/scheduled-tasks', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    update: (id: string, input: UpdateScheduleTaskInput) => request<ScheduleTask | null>(
      `/api/scheduled-tasks/${encodeURIComponent(id)}`,
      { method: 'PUT', body: JSON.stringify(input) },
    ),
    delete: async (id: string) => {
      await request(`/api/scheduled-tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    trigger: (id: string) => request<ScheduleTaskRun>(
      `/api/scheduled-tasks/${encodeURIComponent(id)}/trigger`,
      { method: 'POST' },
    ),
  };
}
