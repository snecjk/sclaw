import {
  evaluateScheduledTaskCreationBlock,
  isLegacyCronToolName,
  isScheduledTaskCreationToolName,
  SCHEDULED_TASK_CORE_PROMPT,
} from '../../../../shared/scheduled-task-instruction';
import type { SclawAgentExtensionDefinition } from '../../../../shared/agent-extensions';
import { STO_SCHEDULED_TASK_CAPABILITY } from './capability';
import { isScheduledTaskShellCommand, stoScheduledTaskTools } from './operations';

export const STO_SCHEDULED_TASK_SYSTEM_PROMPT = [
  'SClaw 本地定时任务工具使用规则：',
  '',
  '【意图分流】',
  '- 根据用户意图使用对应工具创建、列出、查看、更新、删除或立即触发 SClaw 本地定时任务。目标和参数明确时直接执行，不要重复询问。',
  '- 未提供准确 taskId 或任务名称时，先调用 list_sto_scheduled_tasks；需要核对完整配置时调用 get_sto_scheduled_task。',
  '- 按名称操作必须使用精确名称。存在重名、目标不明确，或删除、立即触发等高影响动作意图不明确时，先简短确认。',
  '- update_sto_scheduled_task 只传需要修改的字段，不得改动未要求变更的配置。',
  '',
  '【时间规则】',
  '- 将自然语言时间转换为 cronExpr；调度按运行 SClaw 的主机本地时区执行。',
  '- cronExpr 使用标准 5 段 `分钟 小时 日 月 星期`。一天多个独立时刻用分号拼接，最多 12 段，例如 `0 9 * * *;30 15 * * *`。',
  '- 多时刻的日/星期必须相同，禁止写成会产生笛卡尔积的 `0,30 9,15 * * *`。每周多选可写 `0 9 * * 1,3`。',
  '- 每月最后一个自然日用 `L`，例如 `0 9 L * *`；与具体日期同时选择可写 `0 9 1,L * *`。',
  '- 用户没有明确分钟、小时、日期、星期或频率，且不同解释会产生不同计划时，先提出一个简短问题。',
  '- 仅在创建或用户明确修改执行时间时传 cronExpr。',
  '',
  '【执行目标与结构化字段】',
  '- 默认继承当前对话的引擎、agent、工作区、模型和供应商账号；用户明确指定时才覆盖，禁止编造 ID、路径或账号。',
  '- promptTemplate 只包含到点执行的干净业务指令，不写 cron 时间、任务管理步骤或媒体元数据行。',
  '- recipients、attachments、skills/skillCode、workflowCode/workflowName 必须使用结构化字段传入，不得只写进 promptTemplate。',
  '- 当前更新工具暂不支持修改 recipients、attachments 或 skills；遇到这类修改应说明限制，不得改写 promptTemplate 伪造。',
  '- PI 当前不支持工作流；在 PI 会话中不要创建包含 workflowCode 的任务。',
  '',
  '【工具边界与结果处理】',
  '- 禁止使用旧版 CronCreate、CronUpdate、CronDelete、CronList、Cron 等工具管理定时任务。',
  '- 定时任务管理只能使用 create/list/get/update/delete/trigger_sto_scheduled_task 工具；禁止通过 shell、CLI、文件或数据库绕过。',
  '- `dws chat message send` 是普通钉钉消息发送，不属于定时任务管理。',
  '- 成功后简明说明任务名称、taskId、执行时间和启用状态；立即触发成功只表示运行已启动。',
].join('\n');

export const stoScheduledTaskToolDefinition: SclawAgentExtensionDefinition = {
  id: 'sto-scheduled-task-tool',
  version: '1.0.0',
  requiredCapabilities: [STO_SCHEDULED_TASK_CAPABILITY],
  tools: stoScheduledTaskTools,
  policies: [{
    id: 'scheduled-task-management-guard',
    beforeTool(event, context) {
      const executionBlock = evaluateScheduledTaskCreationBlock({
        sessionKey: context.sessionKey,
        toolName: event.rawToolName,
      });
      if (executionBlock.blocked) {
        return {
          action: 'deny',
          reason: executionBlock.reason
            ?? '定时任务执行过程中禁止创建或修改其他定时任务。',
        };
      }
      if (isLegacyCronToolName(event.rawToolName)) {
        return { action: 'deny', reason: '旧版 Cron 工具已禁用，请使用 sto-scheduled-task-tool。' };
      }
      if (isScheduledTaskCreationToolName(event.rawToolName)) return { action: 'allow' };
      if (event.toolName === 'bash') {
        const command = typeof event.input.command === 'string' ? event.input.command : '';
        if (isScheduledTaskShellCommand(command)) {
          return {
            action: 'deny',
            reason: '禁止通过 shell 或直接修改文件管理定时任务，请使用 sto-scheduled-task-tool。',
          };
        }
      }
      return { action: 'allow' };
    },
  }],
  prompts: [{
    id: 'scheduled-task-guidance',
    build(context) {
      return context.mode === 'scheduled'
        ? SCHEDULED_TASK_CORE_PROMPT
        : STO_SCHEDULED_TASK_SYSTEM_PROMPT;
    },
  }],
};
