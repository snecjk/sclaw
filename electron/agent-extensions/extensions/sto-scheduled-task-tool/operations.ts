import { Type, type Static, type TObject } from 'typebox';
import type { CreateScheduleTaskInput, UpdateScheduleTaskInput } from '../../../db/models/dto/schedule-task.dto';
import type { ScheduleTask } from '../../../db/models/domain/schedule-task';
import { normalizeDingTalkMentions } from '../../../../shared/dingtalk-send/dingtalk-mention';
import {
  sclawToolFailure,
  type SclawExtensionBuildContext,
  type SclawToolDefinition,
  type SclawToolOutcome,
} from '../../../../shared/agent-extensions';
import { STO_SCHEDULED_TASK_CAPABILITY, type StoScheduledTaskPort } from './capability';
import { STO_SCHEDULED_TASK_MANAGEMENT_ACTIVATION } from './activation';

type Defaults = {
  accountId?: string;
  agentId: string;
  model?: string;
  sessionKey: string;
  workspacePath?: string;
};

function extractAgentId(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return (agentId || 'main').trim().toLowerCase();
}

async function resolveDefaults(
  context: SclawExtensionBuildContext,
  port: StoScheduledTaskPort,
): Promise<Defaults> {
  const resolved = await port.resolveDefaults(context.sessionKey);
  const agentId = context.agentId || resolved.agentId || extractAgentId(context.sessionKey);
  return {
    accountId: context.accountId || resolved.accountId,
    agentId,
    model: context.model || resolved.model,
    sessionKey: context.sessionKey,
    workspacePath: context.cwd || resolved.workspacePath,
  };
}

function requireNonEmpty(value: string | undefined, field: string): string {
  const normalized = value?.trim() || '';
  if (!normalized) throw new Error(`${field} 为必填`);
  return normalized;
}

async function resolveTask(
  port: StoScheduledTaskPort,
  input: { taskId?: string; taskName?: string },
): Promise<ScheduleTask> {
  const tasks = await port.list();
  const taskId = input.taskId?.trim();
  if (taskId) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) throw new Error(`未找到定时任务「${taskId}」`);
    return task;
  }
  const taskName = input.taskName?.trim();
  if (!taskName) throw new Error('必须提供 taskId 或 taskName');
  const matches = tasks.filter((item) => item.name === taskName);
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) throw new Error(`存在多个名为「${taskName}」的定时任务，请改用 taskId。`);
  throw new Error(`未找到名为「${taskName}」的定时任务`);
}

function normalizeAttachments(raw: unknown): CreateScheduleTaskInput['attachments'] {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const sourcePath = typeof record.sourcePath === 'string' ? record.sourcePath.trim() : '';
    if (!sourcePath || seen.has(sourcePath)) return [];
    seen.add(sourcePath);
    return [{
      sourcePath,
      fileName: typeof record.fileName === 'string' ? record.fileName.trim() || undefined : undefined,
      mimeType: typeof record.mimeType === 'string' ? record.mimeType.trim() || undefined : undefined,
    }];
  });
}

function normalizeSkills(raw: unknown, skillCode?: string): Array<{ slug: string; title?: string }> {
  const values: Array<{ slug: string; title?: string }> = [];
  const seen = new Set<string>();
  const add = (slug: string, title?: string) => {
    const normalized = slug.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    values.push({ slug: normalized, title: title?.trim() || undefined });
  };
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      if (typeof record.slug === 'string') add(record.slug, typeof record.title === 'string' ? record.title : undefined);
    }
  }
  if (skillCode) add(skillCode);
  return values;
}

async function run<T>(type: string, handler: () => Promise<T>, message?: string): Promise<SclawToolOutcome<T>> {
  try {
    return { success: true, type, domain: 'scheduled_task', data: await handler(), message };
  } catch (error) {
    return sclawToolFailure(
      'scheduled_task',
      'sto_scheduled_task_error',
      error instanceof Error ? error.message : String(error),
    );
  }
}

const identitySchema = Type.Object({
  taskId: Type.Optional(Type.String({ description: '精确任务 id' })),
  taskName: Type.Optional(Type.String({ description: '未知 taskId 时使用精确任务名' })),
});

const createSchema = Type.Object({
  name: Type.String({ minLength: 1, description: '任务短标题' }),
  promptTemplate: Type.String({ minLength: 1, description: '到点执行的干净业务指令' }),
  cronExpr: Type.String({ minLength: 1, description: '5 段 cron，多个时刻用分号分隔' }),
  agentId: Type.Optional(Type.String()),
  workspacePath: Type.Optional(Type.String()),
  providerAccountId: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  timeoutSec: Type.Optional(Type.Integer({ minimum: 1, maximum: 86_400 })),
  enabled: Type.Optional(Type.Boolean()),
  recipients: Type.Optional(Type.Array(Type.Object({
    type: Type.Union([Type.Literal('user'), Type.Literal('group')]),
    displayName: Type.String({ minLength: 1 }),
    userId: Type.Optional(Type.String()),
    openConversationId: Type.Optional(Type.String()),
    corpId: Type.Optional(Type.String()),
  }))),
  attachments: Type.Optional(Type.Array(Type.Object({
    sourcePath: Type.String({ minLength: 1 }),
    fileName: Type.Optional(Type.String()),
    mimeType: Type.Optional(Type.String()),
  }))),
  skillCode: Type.Optional(Type.String()),
  skills: Type.Optional(Type.Array(Type.Object({
    slug: Type.String({ minLength: 1 }),
    title: Type.Optional(Type.String()),
  }))),
  workflowCode: Type.Optional(Type.String()),
  workflowName: Type.Optional(Type.String()),
});

const updateSchema = Type.Object({
  ...identitySchema.properties,
  name: Type.Optional(Type.String()),
  promptTemplate: Type.Optional(Type.String()),
  cronExpr: Type.Optional(Type.String()),
  enabled: Type.Optional(Type.Boolean()),
  agentId: Type.Optional(Type.String()),
  workspacePath: Type.Optional(Type.String()),
  providerAccountId: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  timeoutSec: Type.Optional(Type.Integer({ minimum: 1, maximum: 86_400 })),
});

function tool<T extends TObject>(definition: SclawToolDefinition<T>): SclawToolDefinition<T> {
  return {
    ...definition,
    modes: ['interactive'],
    activation: STO_SCHEDULED_TASK_MANAGEMENT_ACTIVATION,
  };
}

export const stoScheduledTaskTools = [
  tool({
    name: 'create_sto_scheduled_task',
    label: '创建定时任务',
    description: '创建由当前 SClaw Agent 引擎执行的本地定时任务。',
    parameters: createSchema,
    async execute(input: Static<typeof createSchema>, context) {
      return run('sto_scheduled_task_created', async () => {
        const port = context.capabilities.require(STO_SCHEDULED_TASK_CAPABILITY);
        const defaults = await resolveDefaults(context, port);
        const workspacePath = input.workspacePath?.trim() || defaults.workspacePath;
        if (!workspacePath) throw new Error('workspacePath 为必填，且无法从当前会话推断');
        const skills = normalizeSkills(input.skills, input.skillCode);
        const recipients = normalizeDingTalkMentions(input.recipients);
        const created = await port.create({
          engineType: context.engine,
          agentId: input.agentId?.trim() || defaults.agentId,
          cronExpr: requireNonEmpty(input.cronExpr, 'cronExpr'),
          enabled: input.enabled,
          model: input.model?.trim() || defaults.model,
          name: requireNonEmpty(input.name, 'name'),
          prompt: requireNonEmpty(input.promptTemplate, 'promptTemplate'),
          accountId: input.providerAccountId?.trim() || defaults.accountId,
          timeoutSec: input.timeoutSec,
          workspacePath,
          dingtalkRecipients: null,
          recipients: recipients.length ? recipients : null,
          attachments: normalizeAttachments(input.attachments),
          skills: skills.length ? skills : null,
          skillCode: skills[0]?.slug ?? null,
          workflowCode: input.workflowCode?.trim() || null,
          workflowName: input.workflowName?.trim() || null,
          sessionKey: defaults.sessionKey,
        });
        return { task: created };
      }, '已创建定时任务。');
    },
  }),
  tool({
    name: 'list_sto_scheduled_tasks', label: '列出定时任务', description: '列出当前用户的 SClaw 定时任务。',
    parameters: Type.Object({ enabledOnly: Type.Optional(Type.Boolean()) }),
    async execute({ enabledOnly }, context) {
      return run('sto_scheduled_task_list', async () => {
        const tasks = await context.capabilities.require(STO_SCHEDULED_TASK_CAPABILITY).list();
        return { tasks: enabledOnly ? tasks.filter((item) => item.enabled) : tasks };
      });
    },
  }),
  tool({
    name: 'get_sto_scheduled_task', label: '查看定时任务', description: '按 taskId 或精确名称查看定时任务。',
    parameters: identitySchema,
    async execute(input, context) {
      return run('sto_scheduled_task_details', async () => ({
        task: await resolveTask(context.capabilities.require(STO_SCHEDULED_TASK_CAPABILITY), input),
      }));
    },
  }),
  tool({
    name: 'update_sto_scheduled_task', label: '更新定时任务', description: '更新定时任务，仅传需要修改的字段。',
    parameters: updateSchema,
    async execute({ taskId, taskName, ...patch }, context) {
      return run('sto_scheduled_task_updated', async () => {
        const port = context.capabilities.require(STO_SCHEDULED_TASK_CAPABILITY);
        const task = await resolveTask(port, { taskId, taskName });
        const defaults = await resolveDefaults(context, port);
        const update: UpdateScheduleTaskInput = {
          ...(patch.agentId?.trim() ? { agentId: patch.agentId.trim() } : {}),
          ...(patch.cronExpr?.trim() ? { cronExpr: patch.cronExpr.trim() } : {}),
          ...(typeof patch.enabled === 'boolean' ? { enabled: patch.enabled } : {}),
          ...(patch.model !== undefined ? { model: patch.model?.trim() || defaults.model } : {}),
          ...(patch.name?.trim() ? { name: patch.name.trim() } : {}),
          ...(patch.promptTemplate?.trim() ? { prompt: patch.promptTemplate.trim() } : {}),
          ...(patch.providerAccountId !== undefined ? { accountId: patch.providerAccountId?.trim() || defaults.accountId } : {}),
          ...(patch.timeoutSec !== undefined ? { timeoutSec: patch.timeoutSec } : {}),
          ...(patch.workspacePath !== undefined ? { workspacePath: patch.workspacePath.trim() || defaults.workspacePath || '' } : {}),
        };
        return { task: await port.update(task.id, update) };
      });
    },
  }),
  tool({
    name: 'delete_sto_scheduled_task', label: '删除定时任务', description: '按 taskId 或精确名称删除定时任务。',
    parameters: identitySchema,
    async execute(input, context) {
      return run('sto_scheduled_task_deleted', async () => {
        const port = context.capabilities.require(STO_SCHEDULED_TASK_CAPABILITY);
        const task = await resolveTask(port, input);
        await port.delete(task.id);
        return { deletedTask: { id: task.id, name: task.name } };
      });
    },
  }),
  tool({
    name: 'trigger_sto_scheduled_task', label: '立即触发定时任务', description: '立即触发指定定时任务。',
    parameters: identitySchema,
    async execute(input, context) {
      return run('sto_scheduled_task_triggered', async () => {
        const port = context.capabilities.require(STO_SCHEDULED_TASK_CAPABILITY);
        const task = await resolveTask(port, input);
        return { task: { id: task.id, name: task.name }, run: await port.trigger(task.id) };
      });
    },
  }),
] as const;

export function isScheduledTaskShellCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  if (!normalized) return false;
  if (/dws\s+chat\s+message\s+send\b/i.test(command)) return false;
  return /\bcron\b|\bschedule(?:d)?\s+task\b|定时任务|计划任务/.test(normalized)
    || /\b(?:claude|sto)-scheduled-task\b/.test(normalized);
}
