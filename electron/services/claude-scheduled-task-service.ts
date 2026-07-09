import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger';
import { expandPath } from '../utils/paths';
import {
  deleteClaudeScheduledTaskDefinition,
  getClaudeScheduledTaskDefinition,
  getLatestClaudeScheduledTaskRunRecord,
  listClaudeScheduledTaskDefinitions,
  listClaudeScheduledTaskLeases,
  readClaudeScheduledTaskSchedulerState,
  type ClaudeScheduledTaskDefinition,
  type ClaudeScheduledTaskRunRecord,
  type ClaudeTaskPermissionProfile,
  upsertClaudeScheduledTaskDefinition,
} from './claude-scheduled-task-store';
import { ClaudeTaskScheduler } from './claude-task-scheduler';
import { type ClaudeTaskEventSink } from './claude-task-worker';

export interface ClaudeScheduledTaskSummary {
  id: string;
  name: string;
  enabled: boolean;
  cronExpr: string;
  promptTemplate: string;
  agentId: string;
  workspacePath: string;
  providerAccountId?: string;
  model?: string;
  permissionProfile: ClaudeTaskPermissionProfile;
  timeoutSec: number;
  workflowCode?: string;
  nextRunAt?: string;
  lastRun?: Pick<ClaudeScheduledTaskRunRecord, 'runId' | 'status' | 'scheduledFor' | 'completedAt' | 'summary' | 'error'> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClaudeScheduledTaskSchedulerStatus {
  lastTickAt?: string;
  runningTaskIds: string[];
  tasks: Record<string, {
    lastRecoveredAt?: string;
    lastScheduledFor?: string;
    nextRunAt?: string;
  }>;
}

export interface ClaudeScheduledTaskCreateInput {
  name: string;
  enabled?: boolean;
  cronExpr: string;
  promptTemplate: string;
  agentId: string;
  workspacePath: string;
  providerAccountId?: string;
  model?: string;
  permissionProfile?: ClaudeTaskPermissionProfile;
  timeoutSec?: number;
  workflowCode?: string;
  retryPolicy?: {
    maxAttempts?: number;
    backoffSec?: number;
  };
  failurePolicy?: {
    pauseAfterConsecutiveFailures?: number;
  };
}

export interface ClaudeScheduledTaskUpdateInput extends Partial<ClaudeScheduledTaskCreateInput> {
  id: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function validateCronExpr(expr: string): string {
  const normalized = expr.trim();
  const parts = normalized.split(/\s+/);
  if (parts.length !== 5) {
    throw new Error('cronExpr must be a standard 5-field cron expression');
  }
  return normalized;
}

function validateRequired(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

function normalizeWorkspacePath(value: string): string {
  return expandPath(validateRequired(value, 'workspacePath'));
}

function normalizePermissionProfile(
  value?: ClaudeTaskPermissionProfile,
): ClaudeTaskPermissionProfile {
  if (value === 'workspace-write' || value === 'dangerous-bypass') {
    return value;
  }
  return 'readonly-safe';
}

/** 含工作流任务的默认超时（秒）：工作流往往要跑数分钟，300s 会把 agent 卡死在轮询中。 */
const WORKFLOW_DEFAULT_TIMEOUT_SEC = 1800;

/** 根据提示词正文粗判是否为工作流任务（调用了 execute_workflow / get_workflow_status）。 */
function isWorkflowPrompt(promptTemplate: string | undefined | null): boolean {
  if (!promptTemplate) return false;
  return /\b(execute_workflow|get_workflow_status)\b/.test(promptTemplate);
}

function buildDefinitionFromCreateInput(input: ClaudeScheduledTaskCreateInput): ClaudeScheduledTaskDefinition {
  const now = nowIso();
  const isWorkflowTask = Boolean(input.workflowCode?.trim()) || isWorkflowPrompt(input.promptTemplate);
  return {
    id: randomUUID(),
    name: validateRequired(input.name, 'name'),
    enabled: input.enabled ?? true,
    cronExpr: validateCronExpr(input.cronExpr),
    promptTemplate: validateRequired(input.promptTemplate, 'promptTemplate'),
    agentId: validateRequired(input.agentId, 'agentId'),
    workspacePath: normalizeWorkspacePath(input.workspacePath),
    providerAccountId: input.providerAccountId?.trim() || undefined,
    model: input.model?.trim() || undefined,
    permissionProfile: normalizePermissionProfile(input.permissionProfile),
    timeoutSec: Math.max(1, input.timeoutSec ?? (isWorkflowTask ? WORKFLOW_DEFAULT_TIMEOUT_SEC : 300)),
    workflowCode: input.workflowCode?.trim() || undefined,
    retryPolicy: {
      maxAttempts: Math.max(1, input.retryPolicy?.maxAttempts ?? 1),
      backoffSec: Math.max(1, input.retryPolicy?.backoffSec ?? 30),
    },
    failurePolicy: {
      pauseAfterConsecutiveFailures: Math.max(1, input.failurePolicy?.pauseAfterConsecutiveFailures ?? 3),
    },
    createdAt: now,
    updatedAt: now,
  };
}

function applyUpdate(
  existing: ClaudeScheduledTaskDefinition,
  input: ClaudeScheduledTaskUpdateInput,
): ClaudeScheduledTaskDefinition {
  return {
    ...existing,
    ...(input.name != null ? { name: validateRequired(input.name, 'name') } : {}),
    ...(input.enabled != null ? { enabled: input.enabled } : {}),
    ...(input.cronExpr != null ? { cronExpr: validateCronExpr(input.cronExpr) } : {}),
    ...(input.promptTemplate != null ? { promptTemplate: validateRequired(input.promptTemplate, 'promptTemplate') } : {}),
    ...(input.agentId != null ? { agentId: validateRequired(input.agentId, 'agentId') } : {}),
    ...(input.workspacePath != null ? { workspacePath: normalizeWorkspacePath(input.workspacePath) } : {}),
    ...(input.providerAccountId !== undefined ? { providerAccountId: input.providerAccountId?.trim() || undefined } : {}),
    ...(input.model !== undefined ? { model: input.model?.trim() || undefined } : {}),
    ...(input.permissionProfile != null ? { permissionProfile: normalizePermissionProfile(input.permissionProfile) } : {}),
    ...(input.timeoutSec != null ? { timeoutSec: Math.max(1, input.timeoutSec) } : {}),
    ...(input.workflowCode !== undefined ? { workflowCode: input.workflowCode?.trim() || undefined } : {}),
    ...(input.retryPolicy != null ? {
      retryPolicy: {
        maxAttempts: Math.max(1, input.retryPolicy.maxAttempts ?? existing.retryPolicy.maxAttempts),
        backoffSec: Math.max(1, input.retryPolicy.backoffSec ?? existing.retryPolicy.backoffSec),
      },
    } : {}),
    ...(input.failurePolicy != null ? {
      failurePolicy: {
        pauseAfterConsecutiveFailures: Math.max(
          1,
          input.failurePolicy.pauseAfterConsecutiveFailures ?? existing.failurePolicy.pauseAfterConsecutiveFailures,
        ),
      },
    } : {}),
    updatedAt: nowIso(),
  };
}

export class ClaudeScheduledTaskService {
  constructor(private readonly scheduler = new ClaudeTaskScheduler()) {}

  startScheduler(): void {
    // 先丢弃关机期间错过/崩溃中断的任务（推进 nextRunAt + 清 stale lease），
    // 再启动 tick。finally 保证即使清扫抛异常调度器仍会启动。
    void this.scheduler.discardMissedOnStartup().finally(() => this.scheduler.start());
  }

  stopScheduler(): void {
    this.scheduler.stop();
  }

  /** Forward the gateway event sink so worker runs can stream to the renderer. */
  setEventSink(sink: ClaudeTaskEventSink | null): void {
    this.scheduler.setEventSink(sink);
  }

  async listTasks(): Promise<ClaudeScheduledTaskSummary[]> {
    const definitions = await listClaudeScheduledTaskDefinitions();
    const state = await readClaudeScheduledTaskSchedulerState();

    return Promise.all(definitions.map(async (definition) => ({
      id: definition.id,
      name: definition.name,
      enabled: definition.enabled,
      cronExpr: definition.cronExpr,
      promptTemplate: definition.promptTemplate,
      agentId: definition.agentId,
      workspacePath: definition.workspacePath,
      providerAccountId: definition.providerAccountId,
      model: definition.model,
      permissionProfile: definition.permissionProfile,
      timeoutSec: definition.timeoutSec,
      workflowCode: definition.workflowCode,
      nextRunAt: state.tasks?.[definition.id]?.nextRunAt,
      lastRun: await getLatestClaudeScheduledTaskRunRecord(definition.id).then((run) => (
        run
          ? {
            runId: run.runId,
            status: run.status,
            scheduledFor: run.scheduledFor,
            completedAt: run.completedAt,
            summary: run.summary,
            error: run.error,
          }
          : null
      )),
      createdAt: definition.createdAt,
      updatedAt: definition.updatedAt,
    })));
  }

  async getTask(id: string): Promise<ClaudeScheduledTaskDefinition | null> {
    return getClaudeScheduledTaskDefinition(id);
  }

  async createTask(input: ClaudeScheduledTaskCreateInput): Promise<ClaudeScheduledTaskDefinition> {
    const definition = buildDefinitionFromCreateInput(input);
    await upsertClaudeScheduledTaskDefinition(definition);
    await this.scheduler.refreshSchedule();
    return definition;
  }

  async updateTask(input: ClaudeScheduledTaskUpdateInput): Promise<ClaudeScheduledTaskDefinition> {
    const existing = await getClaudeScheduledTaskDefinition(input.id);
    if (!existing) {
      throw new Error(`Claude scheduled task "${input.id}" not found`);
    }

    const next = applyUpdate(existing, input);
    await upsertClaudeScheduledTaskDefinition(next);
    await this.scheduler.refreshSchedule();
    return next;
  }

  async deleteTask(id: string): Promise<void> {
    const removed = await deleteClaudeScheduledTaskDefinition(id);
    if (!removed) {
      throw new Error(`Claude scheduled task "${id}" not found`);
    }
    await this.scheduler.refreshSchedule();
  }

  async triggerTask(id: string): Promise<ClaudeScheduledTaskRunRecord> {
    const existing = await getClaudeScheduledTaskDefinition(id);
    if (!existing) {
      throw new Error(`Claude scheduled task "${id}" not found`);
    }
    return this.scheduler.triggerTaskNow(id);
  }

  async getSchedulerStatus(): Promise<ClaudeScheduledTaskSchedulerStatus> {
    const [state, leases] = await Promise.all([
      readClaudeScheduledTaskSchedulerState(),
      listClaudeScheduledTaskLeases(),
    ]);

    return {
      lastTickAt: state.lastTickAt,
      runningTaskIds: leases
        .filter((lease) => new Date(lease.leaseUntil).getTime() > Date.now())
        .map((lease) => lease.taskId),
      tasks: state.tasks ?? {},
    };
  }

  async refreshSchedule(): Promise<void> {
    await this.scheduler.refreshSchedule();
  }
}

let claudeScheduledTaskServiceInstance: ClaudeScheduledTaskService | null = null;

export function getClaudeScheduledTaskService(): ClaudeScheduledTaskService {
  if (!claudeScheduledTaskServiceInstance) {
    claudeScheduledTaskServiceInstance = new ClaudeScheduledTaskService();
    logger.info('[claude-task] initialized scheduled task service');
  }
  return claudeScheduledTaskServiceInstance;
}
