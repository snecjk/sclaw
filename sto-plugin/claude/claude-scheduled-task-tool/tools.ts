import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from '../zod-shim.js';
import { getScheduledTaskService } from '../../../electron/services/scheduled-task-service';
import type {
  CreateScheduleTaskInput,
  UpdateScheduleTaskInput,
} from '../../../electron/db/models/dto/schedule-task.dto';
import type { ScheduleTask } from '../../../electron/db/models/domain/schedule-task';
import { getEngineSessionRegistryEntry } from '../../../electron/engines/session-registry';
import { getAgentWorkspacePath } from '../../../electron/utils/agent-config';

export const CLAUDE_SCHEDULED_TASK_SYSTEM_PROMPT = [
  'Claude scheduled task tools:',
  '- Use these tools to create, inspect, update, delete, and trigger Claude local scheduled tasks.',
  '- Never use legacy CronCreate/CronUpdate/CronDelete/CronList/Cron tools for Claude scheduled task management.',
  '- Translate natural-language schedules into standard 5-field cronExpr values before calling create or update.',
  '- If the requested schedule is ambiguous, ask a concise follow-up question instead of guessing.',
  '- Default to the current Claude conversation agent and workspace unless the user explicitly requests another target.',
  '- Do not use Bash, exec, or manual filesystem edits to manage Claude scheduled tasks.',
].join('\n');

interface ScheduledTaskToolConfig {
  sessionKey: string;
}

interface ScheduledTaskEnvelope<T = unknown> {
  type: string;
  success: boolean;
  domain: 'scheduled_task';
  message?: string;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

function resultFromEnvelope(envelope: ScheduledTaskEnvelope): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(envelope) }],
    isError: !envelope.success,
  };
}

function successResult<T>(type: string, data: T, message?: string): CallToolResult {
  return resultFromEnvelope({
    type,
    success: true,
    domain: 'scheduled_task',
    message,
    data,
  });
}

function errorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return resultFromEnvelope({
    type: 'claude_scheduled_task_error',
    success: false,
    domain: 'scheduled_task',
    message,
    error: {
      code: 'claude_scheduled_task_error',
      message,
    },
  });
}

async function runScheduledTaskTool<T>(
  type: string,
  handler: () => Promise<T>,
  message?: string,
): Promise<CallToolResult> {
  try {
    return successResult(type, await handler(), message);
  } catch (error) {
    return errorResult(error);
  }
}

function extractAgentId(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return (agentId || 'main').trim().toLowerCase();
}

async function resolveConversationDefaults(sessionKey: string): Promise<{
  accountId?: string;
  agentId: string;
  model?: string;
  workspacePath?: string;
}> {
  const entry = await getEngineSessionRegistryEntry(sessionKey);
  const agentId = entry?.agentId || extractAgentId(sessionKey);
  const workspacePath = entry?.cwd || await getAgentWorkspacePath(agentId) || undefined;

  return {
    accountId: entry?.accountId,
    agentId,
    model: entry?.model,
    workspacePath,
  };
}

function requireNonEmpty(value: string | undefined, field: string): string {
  const normalized = value?.trim() || '';
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

async function resolveTaskByIdentity(input: {
  taskId?: string;
  taskName?: string;
}): Promise<ScheduleTask> {
  const service = getScheduledTaskService();
  const tasks = await service.listTasks();

  const taskId = input.taskId?.trim();
  if (taskId) {
    const byId = tasks.find((task) => task.id === taskId);
    if (!byId) {
      throw new Error(`Claude scheduled task "${taskId}" not found`);
    }
    return byId;
  }

  const taskName = input.taskName?.trim();
  if (!taskName) {
    throw new Error('taskId or taskName is required');
  }

  const exactMatches = tasks.filter((task) => task.name === taskName);
  if (exactMatches.length === 1) {
    return exactMatches[0]!;
  }
  if (exactMatches.length > 1) {
    throw new Error(`Multiple Claude scheduled tasks are named "${taskName}". Use taskId instead.`);
  }

  throw new Error(`Claude scheduled task "${taskName}" not found`);
}

async function resolveTaskSummary(taskId: string): Promise<ScheduleTask | null> {
  const tasks = await getScheduledTaskService().listTasks();
  return tasks.find((task) => task.id === taskId) ?? null;
}

function toCreateInput(
  defaults: Awaited<ReturnType<typeof resolveConversationDefaults>>,
  input: {
    agentId?: string;
    cronExpr: string;
    enabled?: boolean;
    model?: string;
    name: string;
    promptTemplate: string;
    providerAccountId?: string;
    timeoutSec?: number;
    workspacePath?: string;
  },
): CreateScheduleTaskInput {
  const workspacePath = input.workspacePath?.trim() || defaults.workspacePath;
  if (!workspacePath) {
    throw new Error('workspacePath is required and could not be inferred from the current conversation');
  }

  return {
    engineType: 'claude',
    agentId: input.agentId?.trim() || defaults.agentId,
    cronExpr: requireNonEmpty(input.cronExpr, 'cronExpr'),
    enabled: input.enabled,
    model: input.model?.trim() || defaults.model,
    name: requireNonEmpty(input.name, 'name'),
    permissionProfile: 'dangerous-bypass',
    prompt: requireNonEmpty(input.promptTemplate, 'promptTemplate'),
    accountId: input.providerAccountId?.trim() || defaults.accountId,
    timeoutSec: input.timeoutSec,
    workspacePath,
  };
}

function toUpdateInput(
  defaults: Awaited<ReturnType<typeof resolveConversationDefaults>>,
  input: {
    agentId?: string;
    cronExpr?: string;
    enabled?: boolean;
    model?: string;
    name?: string;
    promptTemplate?: string;
    providerAccountId?: string;
    timeoutSec?: number;
    workspacePath?: string;
  },
): UpdateScheduleTaskInput {
  return {
    ...(input.agentId?.trim() ? { agentId: input.agentId.trim() } : {}),
    ...(input.cronExpr?.trim() ? { cronExpr: input.cronExpr.trim() } : {}),
    ...(typeof input.enabled === 'boolean' ? { enabled: input.enabled } : {}),
    ...(input.model !== undefined ? { model: input.model?.trim() || defaults.model } : {}),
    ...(input.name?.trim() ? { name: input.name.trim() } : {}),
    permissionProfile: 'dangerous-bypass',
    ...(input.promptTemplate?.trim() ? { prompt: input.promptTemplate.trim() } : {}),
    ...(input.providerAccountId !== undefined
      ? { accountId: input.providerAccountId?.trim() || defaults.accountId }
      : {}),
    ...(input.timeoutSec !== undefined ? { timeoutSec: input.timeoutSec } : {}),
    ...(input.workspacePath !== undefined
      ? { workspacePath: input.workspacePath.trim() || defaults.workspacePath || '' }
      : {}),
  };
}

export function createClaudeScheduledTaskTools(config: ScheduledTaskToolConfig) {
  const createClaudeScheduledTask = tool(
    'create_claude_scheduled_task',
    [
      'Create a Claude local scheduled task immediately from confirmed user intent.',
      'Pass a standard 5-field cronExpr.',
      'If agentId or workspacePath is omitted, the current Claude conversation defaults will be used.',
    ].join('\n'),
    {
      name: z.string().min(1).describe('User-facing task name'),
      promptTemplate: z.string().min(1).describe('Prompt that the scheduled Claude task should execute'),
      cronExpr: z.string().min(1).describe('Standard 5-field cron expression, for example "0 9 * * *"'),
      agentId: z.string().optional().describe('Optional target Claude agent id; defaults to the current conversation agent'),
      workspacePath: z.string().optional().describe('Optional workspace root; defaults to the current conversation workspace'),
      providerAccountId: z.string().optional().describe('Optional provider account id override'),
      model: z.string().optional().describe('Optional model override'),
      timeoutSec: z.number().int().min(1).max(86_400).optional().describe('Optional timeout in seconds'),
      enabled: z.boolean().optional().describe('Whether the task should be enabled immediately; default true'),
    },
    async (input) => runScheduledTaskTool('claude_scheduled_task_created', async () => {
      const defaults = await resolveConversationDefaults(config.sessionKey);
      const created = await getScheduledTaskService().createTask(toCreateInput(defaults, input));
      const summary = await resolveTaskSummary(created.id);
      return {
        task: summary ?? created,
        defaultsUsed: {
          agentId: !input.agentId,
          workspacePath: !input.workspacePath,
        },
      };
    }),
  );

  const listClaudeScheduledTasks = tool(
    'list_claude_scheduled_tasks',
    'List Claude local scheduled tasks available in StoClaw.',
    {
      enabledOnly: z.boolean().optional().describe('If true, return only enabled tasks'),
    },
    async ({ enabledOnly }) => runScheduledTaskTool('claude_scheduled_task_list', async () => {
      const tasks = await getScheduledTaskService().listTasks();
      return {
        tasks: enabledOnly ? tasks.filter((task) => task.enabled) : tasks,
      };
    }),
  );

  const getClaudeScheduledTask = tool(
    'get_claude_scheduled_task',
    'Get one Claude local scheduled task by taskId or exact taskName.',
    {
      taskId: z.string().optional().describe('Exact task id'),
      taskName: z.string().optional().describe('Exact task name when taskId is unknown'),
    },
    async ({ taskId, taskName }) => runScheduledTaskTool('claude_scheduled_task_details', async () => {
      return {
        task: await resolveTaskByIdentity({ taskId, taskName }),
      };
    }),
  );

  const updateClaudeScheduledTask = tool(
    'update_claude_scheduled_task',
    [
      'Update a Claude local scheduled task by taskId or exact taskName.',
      'Pass only the fields that should change.',
      'Use a 5-field cronExpr when changing the schedule.',
    ].join('\n'),
    {
      taskId: z.string().optional().describe('Exact task id'),
      taskName: z.string().optional().describe('Exact task name when taskId is unknown'),
      name: z.string().optional().describe('New task name'),
      promptTemplate: z.string().optional().describe('New task prompt'),
      cronExpr: z.string().optional().describe('New standard 5-field cron expression'),
      enabled: z.boolean().optional().describe('Enable or disable the task'),
      agentId: z.string().optional().describe('Optional target Claude agent id'),
      workspacePath: z.string().optional().describe('Optional workspace root'),
      providerAccountId: z.string().optional().describe('Optional provider account id override'),
      model: z.string().optional().describe('Optional model override'),
      timeoutSec: z.number().int().min(1).max(86_400).optional().describe('Optional timeout in seconds'),
    },
    async ({ taskId, taskName, ...patch }) => runScheduledTaskTool('claude_scheduled_task_updated', async () => {
      const existing = await resolveTaskByIdentity({ taskId, taskName });
      const defaults = await resolveConversationDefaults(config.sessionKey);
      const updated = await getScheduledTaskService().updateTask(
        existing.id,
        toUpdateInput(defaults, patch),
      );
      const summary = await resolveTaskSummary(existing.id);
      return {
        task: summary ?? updated,
      };
    }),
  );

  const deleteClaudeScheduledTask = tool(
    'delete_claude_scheduled_task',
    'Delete a Claude local scheduled task by taskId or exact taskName.',
    {
      taskId: z.string().optional().describe('Exact task id'),
      taskName: z.string().optional().describe('Exact task name when taskId is unknown'),
    },
    async ({ taskId, taskName }) => runScheduledTaskTool('claude_scheduled_task_deleted', async () => {
      const task = await resolveTaskByIdentity({ taskId, taskName });
      await getScheduledTaskService().deleteTask(task.id);
      return {
        deletedTask: {
          id: task.id,
          name: task.name,
        },
      };
    }),
  );

  const triggerClaudeScheduledTask = tool(
    'trigger_claude_scheduled_task',
    'Trigger a Claude local scheduled task immediately by taskId or exact taskName.',
    {
      taskId: z.string().optional().describe('Exact task id'),
      taskName: z.string().optional().describe('Exact task name when taskId is unknown'),
    },
    async ({ taskId, taskName }) => runScheduledTaskTool('claude_scheduled_task_triggered', async () => {
      const task = await resolveTaskByIdentity({ taskId, taskName });
      const run = await getScheduledTaskService().triggerTask(task.id);
      return {
        task: {
          id: task.id,
          name: task.name,
        },
        run,
      };
    }),
  );

  return [
    createClaudeScheduledTask,
    listClaudeScheduledTasks,
    getClaudeScheduledTask,
    updateClaudeScheduledTask,
    deleteClaudeScheduledTask,
    triggerClaudeScheduledTask,
  ];
}

export function createClaudeScheduledTaskMcpServer(config: ScheduledTaskToolConfig) {
  return createSdkMcpServer({
    name: 'claude-scheduled-task-tool',
    version: '1.0.0',
    instructions: CLAUDE_SCHEDULED_TASK_SYSTEM_PROMPT,
    tools: createClaudeScheduledTaskTools(config),
  });
}
