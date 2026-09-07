import type {
  CreateScheduleTaskInput,
  UpdateScheduleTaskInput,
} from '../../../db/models/dto/schedule-task.dto';
import type {
  ScheduleTask,
  ScheduleTaskRun,
} from '../../../db/models/domain/schedule-task';
import { createSclawCapabilityToken } from '../../../../shared/agent-extensions';

export interface StoScheduledTaskPort {
  resolveDefaults(sessionKey: string): Promise<{
    accountId?: string;
    agentId: string;
    model?: string;
    workspacePath?: string;
  }>;
  list(): Promise<ScheduleTask[]>;
  create(input: CreateScheduleTaskInput): Promise<ScheduleTask>;
  update(id: string, input: UpdateScheduleTaskInput): Promise<ScheduleTask | null>;
  delete(id: string): Promise<void>;
  trigger(id: string): Promise<ScheduleTaskRun>;
}

export const STO_SCHEDULED_TASK_CAPABILITY = createSclawCapabilityToken<StoScheduledTaskPort>(
  'sto.scheduled-task',
);
