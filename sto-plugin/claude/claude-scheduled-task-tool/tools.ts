import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from '../zod-shim.js';
import { getScheduledTaskService } from '../../../electron/scheduled-tasks/scheduled-task-service';
import type {
  CreateScheduleTaskInput,
  UpdateScheduleTaskInput,
} from '../../../electron/db/models/dto/schedule-task.dto';
import type { ScheduleTask } from '../../../electron/db/models/domain/schedule-task';
import { getEngineSessionRegistryEntry } from '../../../electron/engines/session-registry';
import { getAgentWorkspacePath } from '../../../electron/utils/agent-config';
import { normalizeDingTalkMentions } from '../../../shared/dingtalk-send/dingtalk-mention';

export const CLAUDE_SCHEDULED_TASK_SYSTEM_PROMPT = [
  'Claude 本地定时任务工具使用规则：',
  '',
  '【意图分流】',
  '- 根据用户意图使用对应工具创建、列出、查看、更新、删除或立即触发 Claude 本地定时任务。用户的目标和参数已经明确时直接执行，不要重复询问确认。',
  '- 用户未提供准确的 taskId 或任务名称时，先调用 list_claude_scheduled_tasks 查找候选；需要核对完整配置时再调用 get_claude_scheduled_task。',
  '- 按任务名称操作时必须使用精确名称。存在多个候选、目标不明确，或删除、立即触发等高影响动作的意图不明确时，先进行简短确认，禁止猜测目标。',
  '- update_claude_scheduled_task 只传需要修改的字段，未要求变更的配置必须保持不变。',
  '',
  '【时间规则】',
  '- 创建任务或修改执行时间前，将自然语言时间转换为标准 5 段 cronExpr：分钟 小时 日 月 星期。调度按运行 StoClaw 的主机本地时区执行。',
  '- 用户没有明确分钟、小时、日期、星期、频率或时区含义，且不同解释会产生不同执行计划时，先提出一个简短问题；禁止自行猜测。',
  '- 仅在创建任务或用户明确要求修改执行时间时传 cronExpr；不得因更新其他字段而擅自改动原执行时间。',
  '',
  '【执行目标与可选配置】',
  '- 默认使用当前 Claude 对话的 agentId、workspacePath、模型和供应商账号；用户未明确指定时省略这些字段，让工具自动继承当前会话配置。',
  '- 用户明确指定其他 agent、工作区、模型、供应商账号、超时时间或启用状态时，按用户提供的值传入；禁止编造 ID、路径或账号。',
  '',
  '【任务指令与钉钉收件人】',
  '- promptTemplate 只能包含定时执行时要完成的干净、完整、可独立理解的业务指令；不要写入 cron 时间、任务管理步骤、StoClaw DingTalk Recipients JSON 或钉钉发送规则块。',
  '- 创建任务时，如果当前消息包含用户通过 @ 选择产生的 StoClaw DingTalk Recipients JSON，必须将其中所有有效收件人原样传给 recipients；禁止遗漏、猜测、搜索替换或写入 promptTemplate。',
  '- 当前更新工具不支持修改 recipients。用户要求修改已有任务的钉钉收件人时，应明确说明当前能力限制，不得通过改写 promptTemplate 伪造收件人配置，也不得擅自删除并重建任务。',
  '',
  '【工具边界与结果处理】',
  '- 禁止使用旧版 CronCreate、CronUpdate、CronDelete、CronList、Cron 等工具管理 Claude 定时任务。',
  '- Claude 定时任务管理只能使用本组工具；禁止通过 Bash、exec、其他 CLI、直接修改文件或数据库来创建、查询、更新、删除或触发任务。',
  '- 上述限制仅针对定时任务管理。`dws chat message send` 是普通钉钉消息发送，不是管理定时任务；即使消息正文含有“定时任务”、cron 或 scheduled task 等字样也允许调用。',
  '- 工具调用失败时，根据错误信息修正明确的参数问题；无法安全修正时直接报告错误，禁止改用 shell、旧版 Cron 工具或文件操作绕过。',
  '- 操作成功后简明说明任务名称、taskId、执行时间和启用状态；立即触发成功只表示运行已启动，不得虚构最终执行结果。',
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
    recipients?: unknown;
    timeoutSec?: number;
    workspacePath?: string;
  },
): CreateScheduleTaskInput {
  const workspacePath = input.workspacePath?.trim() || defaults.workspacePath;
  if (!workspacePath) {
    throw new Error('workspacePath is required and could not be inferred from the current conversation');
  }

  const recipients = normalizeDingTalkMentions(input.recipients);

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
    dingtalkRecipients: recipients.length > 0 ? recipients : null,
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
      'promptTemplate must be a clean business instruction (do not bake DingTalk recipient rule blocks).',
      'When the user @-picked DingTalk recipients, pass them as recipients; they are stored in dingtalk_recipients_json.',
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
      recipients: z
        .array(
          z.object({
            type: z.enum(['user', 'group']),
            displayName: z.string().min(1),
            userId: z.string().optional(),
            openConversationId: z.string().optional(),
            corpId: z.string().optional(),
          }),
        )
        .optional()
        .describe('Optional DingTalk recipients (DingTalkMention[]); required when user @-picked people/groups'),
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
