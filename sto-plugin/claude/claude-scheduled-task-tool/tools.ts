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
  '【任务指令与结构化字段（与 UI Modal 同构）】',
  '- promptTemplate 只能包含定时执行时要完成的干净业务指令；可用 `@真实展示名`、`[文件: 真实文件名]`、`[技能: 真实技能标题]`（必须是会话里出现过的真实值，**禁止**照抄 `<…>` / `文件名` / `标题` 这类文档占位符）。',
  '- 不要写入 cron 时间、任务管理步骤、StoClaw DingTalk Recipients JSON、钉钉发送规则块或 `[media attached:…]` 行。',
  '- **结构化字段强制（禁止只写进 promptTemplate；全部进 extra.composerSegments，可多个）**：',
  '- recipients：用户 @ 选人时必须原样传入；**不写** dingtalk_recipients_json 列。',
  '- attachments：本轮附图时必须传入 sourcePath（复制用户消息 `[media attached: path (mime) | …]`）；系统复制到任务持久目录。',
  '- skills / skillCode：必须传 slug（及 title）；可多个；**不写** skill_code 列。',
  '- workflowCode / workflowName：任务含执行工作流时**必须**传；可多个；**不写** workflow_code 列。',
  '- 当前更新工具暂不支持改 recipients/attachments/skills。用户要求改已有任务的这些字段时，应说明能力限制，不得改写 promptTemplate 伪造，也不得擅自删建。',
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
  sessionKey: string;
  workspacePath?: string;
}> {
  const entry = await getEngineSessionRegistryEntry(sessionKey);
  const agentId = entry?.agentId || extractAgentId(sessionKey);
  const workspacePath = entry?.cwd || await getAgentWorkspacePath(agentId) || undefined;

  return {
    accountId: entry?.accountId,
    agentId,
    model: entry?.model,
    sessionKey,
    workspacePath,
  };
}

function requireNonEmpty(value: string | undefined, field: string): string {
  const normalized = value?.trim() || '';
  if (!normalized) {
    throw new Error(`${field} 为必填`);
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
      throw new Error(`未找到 Claude 定时任务「${taskId}」`);
    }
    return byId;
  }

  const taskName = input.taskName?.trim();
  if (!taskName) {
    throw new Error('必须提供 taskId 或 taskName');
  }

  const exactMatches = tasks.filter((task) => task.name === taskName);
  if (exactMatches.length === 1) {
    return exactMatches[0]!;
  }
  if (exactMatches.length > 1) {
    throw new Error(`存在多个名为「${taskName}」的 Claude 定时任务，请改用 taskId。`);
  }

  throw new Error(`未找到名为「${taskName}」的 Claude 定时任务`);
}

async function resolveTaskSummary(taskId: string): Promise<ScheduleTask | null> {
  const tasks = await getScheduledTaskService().listTasks();
  return tasks.find((task) => task.id === taskId) ?? null;
}

function normalizeAttachments(raw: unknown): Array<{
  fileName?: string;
  mimeType?: string;
  sourcePath: string;
}> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ fileName?: string; mimeType?: string; sourcePath: string }> = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const sourcePath = typeof record.sourcePath === 'string' ? record.sourcePath.trim() : '';
    if (!sourcePath || seen.has(sourcePath)) continue;
    seen.add(sourcePath);
    out.push({
      sourcePath,
      fileName: typeof record.fileName === 'string' && record.fileName.trim()
        ? record.fileName.trim()
        : undefined,
      mimeType: typeof record.mimeType === 'string' && record.mimeType.trim()
        ? record.mimeType.trim()
        : undefined,
    });
  }
  return out;
}

function normalizeSkills(
  raw: unknown,
  skillCode?: string,
): Array<{ slug: string; title?: string }> {
  const out: Array<{ slug: string; title?: string }> = [];
  const seen = new Set<string>();
  const push = (slug: string, title?: string) => {
    const s = slug.trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push({ slug: s, title: title?.trim() || undefined });
  };
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      if (typeof record.slug === 'string') {
        push(record.slug, typeof record.title === 'string' ? record.title : undefined);
      }
    }
  }
  if (skillCode?.trim()) push(skillCode.trim());
  return out;
}

function toCreateInput(
  defaults: Awaited<ReturnType<typeof resolveConversationDefaults>>,
  input: {
    agentId?: string;
    attachments?: unknown;
    cronExpr: string;
    enabled?: boolean;
    model?: string;
    name: string;
    promptTemplate: string;
    providerAccountId?: string;
    recipients?: unknown;
    skillCode?: string;
    skills?: unknown;
    timeoutSec?: number;
    workflowCode?: string;
    workflowName?: string;
    workspacePath?: string;
  },
): CreateScheduleTaskInput {
  const workspacePath = input.workspacePath?.trim() || defaults.workspacePath;
  if (!workspacePath) {
    throw new Error('workspacePath 为必填，且无法从当前会话推断');
  }

  const recipients = normalizeDingTalkMentions(input.recipients);
  const attachments = normalizeAttachments(input.attachments);
  const skills = normalizeSkills(input.skills, input.skillCode);
  const workflowCode = input.workflowCode?.trim() || null;
  const workflowName = input.workflowName?.trim() || null;

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
    // 与 OpenClaw / Modal 同构：列清空，结构化字段交 createTask align
    dingtalkRecipients: null,
    recipients: recipients.length > 0 ? recipients : null,
    attachments: attachments.length > 0 ? attachments : null,
    skills: skills.length > 0 ? skills : null,
    skillCode: skills[0]?.slug ?? null,
    workflowCode,
    workflowName,
    sessionKey: defaults.sessionKey ?? null,
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
      '根据用户已确认的意图立即创建 Claude 本地定时任务。',
      '传入标准 5 段 cronExpr。',
      '若省略 agentId 或 workspacePath，将使用当前 Claude 会话的默认值。',
      'promptTemplate 必须是干净的业务指令（不要写入钉钉发送规则块或 [media attached:] 行）。',
      '用户 @ 选钉钉收件人时传入 recipients（写入 extra.composerSegments，不写列）。',
      '用户附图时传入 attachments，sourcePath 为 outbound 绝对路径。',
      '用到技能/工作流时传入 skills/skillCode 与 workflowCode/workflowName（与 UI Modal 同构）。',
    ].join('\n'),
    {
      name: z.string().min(1).describe('任务短标题'),
      promptTemplate: z.string().min(1).describe('到点由 Claude 执行的干净业务指令'),
      cronExpr: z.string().min(1).describe('标准 5 段 cron 表达式，例如 "0 9 * * *"'),
      agentId: z.string().optional().describe('可选目标 Claude agent id；缺省为当前会话 agent'),
      workspacePath: z.string().optional().describe('可选工作区根路径；缺省为当前会话工作区'),
      providerAccountId: z.string().optional().describe('可选供应商账号 id 覆盖'),
      model: z.string().optional().describe('可选模型覆盖'),
      timeoutSec: z.number().int().min(1).max(86_400).optional().describe('可选超时秒数'),
      enabled: z.boolean().optional().describe('是否立即启用；缺省 true'),
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
        .describe('钉钉收件人（DingTalkMention[]）；用户 @ 选人/群时必传；写入 extra.composerSegments'),
      attachments: z
        .array(
          z.object({
            sourcePath: z.string().min(1).describe('本地 outbound 绝对路径，通常在 ~/.stoclaw/ 下'),
            fileName: z.string().optional(),
            mimeType: z.string().optional(),
          }),
        )
        .optional()
        .describe('附图。来自 [media attached: path (mime) | …] 时必须传 sourcePath；系统复制到任务附件目录'),
      skillCode: z.string().optional().describe('主技能 slug'),
      skills: z
        .array(
          z.object({
            slug: z.string().min(1),
            title: z.string().optional(),
          }),
        )
        .optional()
        .describe('任务用到的技能（slug + title）'),
      workflowCode: z.string().optional().describe('工作流实例 id（如 wf_xxx）'),
      workflowName: z.string().optional().describe('工作流展示名'),
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
    }, '已创建定时任务。'),
  );

  const listClaudeScheduledTasks = tool(
    'list_claude_scheduled_tasks',
    '列出 StoClaw 中的 Claude 本地定时任务。',
    {
      enabledOnly: z.boolean().optional().describe('为 true 时只返回已启用的任务'),
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
    '按 taskId 或精确任务名获取一条 Claude 本地定时任务。',
    {
      taskId: z.string().optional().describe('精确任务 id'),
      taskName: z.string().optional().describe('未知 taskId 时使用精确任务名'),
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
      '按 taskId 或精确任务名更新 Claude 本地定时任务。',
      '只传需要修改的字段。',
      '修改执行时间时使用 5 段 cronExpr。',
    ].join('\n'),
    {
      taskId: z.string().optional().describe('精确任务 id'),
      taskName: z.string().optional().describe('未知 taskId 时使用精确任务名'),
      name: z.string().optional().describe('新的任务名称'),
      promptTemplate: z.string().optional().describe('新的任务指令'),
      cronExpr: z.string().optional().describe('新的标准 5 段 cron 表达式'),
      enabled: z.boolean().optional().describe('启用或停用任务'),
      agentId: z.string().optional().describe('可选目标 Claude agent id'),
      workspacePath: z.string().optional().describe('可选工作区根路径'),
      providerAccountId: z.string().optional().describe('可选供应商账号 id 覆盖'),
      model: z.string().optional().describe('可选模型覆盖'),
      timeoutSec: z.number().int().min(1).max(86_400).optional().describe('可选超时秒数'),
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
    '按 taskId 或精确任务名删除 Claude 本地定时任务。',
    {
      taskId: z.string().optional().describe('精确任务 id'),
      taskName: z.string().optional().describe('未知 taskId 时使用精确任务名'),
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
    '按 taskId 或精确任务名立即触发 Claude 本地定时任务。',
    {
      taskId: z.string().optional().describe('精确任务 id'),
      taskName: z.string().optional().describe('未知 taskId 时使用精确任务名'),
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
