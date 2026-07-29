/**
 * Self-contained helpers for Gateway extension install.
 * `SCHEDULED_TASK_CORE_PROMPT` 由 `./scheduled-task-core.ts` 提供（`pnpm run sync:plugin-shared`）。
 * Session-key / normalize helpers 与 `shared/scheduled-task-instruction.ts` 保持一致。
 *
 * 钉钉格式/必发（模块 A/C）不在此插件注入——由统一执行器 systemPromptAppend 负责。
 */

export { SCHEDULED_TASK_CORE_PROMPT } from './scheduled-task-core.js';
import { SCHEDULED_TASK_CORE_PROMPT } from './scheduled-task-core.js';

export interface NormalizeScheduledTaskInstructionInput {
  instruction: string;
  workflowId?: string;
  workflowName?: string;
}

export interface NormalizeScheduledTaskInstructionResult {
  instruction: string;
  changed: boolean;
  warnings: string[];
}

/** @deprecated 插件执行注入已改为仅 CORE；保留别名避免旧 import 断裂。 */
export const SCHEDULED_TASK_EXECUTION_SYSTEM_PROMPT = SCHEDULED_TASK_CORE_PROMPT;

const OPENCLAW_SCHEDULED_TASK_CREATION_TOOLS = new Set([
  'cron',
  'create_scheduled_task',
  'croncreate',
  'cronupdate',
  'crondelete',
  'cronlist',
  'cronrun',
]);

const CLAUDE_SCHEDULED_TASK_MUTATION_TOOLS = new Set([
  'create_claude_scheduled_task',
  'update_claude_scheduled_task',
  'delete_claude_scheduled_task',
  'trigger_claude_scheduled_task',
]);

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function buildWorkflowExecutionInstruction(
  workflowId: string,
  workflowName?: string,
): string {
  const label = workflowName?.trim() || workflowId;
  return `帮我执行 id 为：${workflowId} 的工作流 【${label}】`;
}

export function isScheduledTaskExecutionSessionKey(sessionKey: string | undefined | null): boolean {
  if (!sessionKey?.trim()) return false;
  const key = sessionKey.trim();

  if (key.startsWith('claude-task:')) return true;
  if (key.startsWith('claude-task-run:')) return true;
  if (key.startsWith('scheduled-task:')) return true;

  if (key.startsWith('agent:')) {
    const parts = key.split(':');
    if (parts.length >= 4 && parts[2] === 'cron') return true;
  }

  const legacyMatch = key.match(/^\[?cron:[^\]]+\]?$/);
  return legacyMatch != null;
}

export function normalizeToolName(toolName: string): string {
  const parts = toolName.split('__');
  return (parts[parts.length - 1] || toolName).trim();
}

export function isLegacyCronToolName(toolName: string): boolean {
  const normalized = normalizeToolName(toolName);
  return /^Cron[A-Z]/.test(normalized) || normalized === 'Cron';
}

export function isScheduledTaskCreationToolName(toolName: string): boolean {
  const normalized = normalizeToolName(toolName).toLowerCase();
  if (OPENCLAW_SCHEDULED_TASK_CREATION_TOOLS.has(normalized)) return true;
  if (CLAUDE_SCHEDULED_TASK_MUTATION_TOOLS.has(normalizeToolName(toolName))) return true;
  return isLegacyCronToolName(toolName);
}

export function evaluateScheduledTaskCreationBlock(params: {
  sessionKey?: string | null;
  toolName: string;
}): { blocked: boolean; reason?: string } {
  if (!isScheduledTaskExecutionSessionKey(params.sessionKey)) {
    return { blocked: false };
  }

  if (!isScheduledTaskCreationToolName(params.toolName)) {
    return { blocked: false };
  }

  return {
    blocked: true,
    reason:
      '定时任务执行过程中禁止再创建或修改定时任务，以避免重复套娃。请只执行当前任务描述中的业务动作。',
  };
}

function stripSchedulePhrases(text: string): string {
  let result = text;

  result = result.replace(
    /(?:每天|每个工作日|工作日|每周[一二三四五六日天]?|每月\d{1,2}[日号]?)\s*(?:上午|下午|早上|晚上|凌晨)?\s*\d{1,2}\s*[:：点时]?\s*\d{0,2}\s*分?/gi,
    '',
  );
  result = result.replace(
    /(?:上午|下午|早上|晚上|凌晨)\s*\d{1,2}\s*[:：点时]?\s*\d{0,2}\s*分?/gi,
    '',
  );
  result = result.replace(/\d{1,2}\s*[:：点时]\s*\d{0,2}\s*分?/gi, '');

  return result;
}

function stripMetaTaskPhrases(text: string): string {
  let result = text;

  result = result.replace(
    /(?:帮我|请|麻烦)?\s*(?:创建|新建|设置|添加|建立|配置)\s*(?:一个|个)?\s*(?:新的?\s*)?(?:定时|计划|周期)?\s*任务\s*(?:来|，|以便|用于|去)?\s*(?:执行|运行)/gi,
    '执行',
  );
  result = result.replace(
    /(?:帮我|请|麻烦)?\s*(?:创建|新建|设置|添加|建立|配置)\s*(?:一个|个)?\s*(?:新的?\s*)?(?:定时|计划|周期)?\s*任务/gi,
    '',
  );
  result = result.replace(
    /(?:帮我|请|麻烦)?\s*(?:创建|新建)\s*(?:一个|个)?\s*(?=执行|运行)/gi,
    '',
  );
  result = result.replace(/^(?:帮我|请|麻烦)\s*/u, '');
  result = result.replace(/(?:定时|计划|周期)执行/gi, '执行');

  return result;
}

function stripTrailingTaskSuffix(text: string): string {
  return text
    .replace(/(?:的)?\s*任务\s*$/u, '')
    .replace(/(?:的)?\s*定时任务\s*$/u, '')
    .trim();
}

export function detectMetaScheduledTaskIntent(text: string): boolean {
  const normalized = collapseWhitespace(text);
  if (!normalized) return false;

  return /(?:创建|新建|设置|添加|建立|配置).{0,12}(?:定时|计划).{0,8}任务/u.test(normalized)
    || /(?:每天|每周|每月).{0,20}(?:创建|新建|设置).{0,12}任务/u.test(normalized);
}

export function normalizeScheduledTaskInstruction(
  input: NormalizeScheduledTaskInstructionInput,
): NormalizeScheduledTaskInstructionResult {
  const warnings: string[] = [];
  const raw = input.instruction.trim();

  if (!raw) {
    return { instruction: '', changed: false, warnings };
  }

  if (input.workflowId?.trim()) {
    const normalized = buildWorkflowExecutionInstruction(
      input.workflowId.trim(),
      input.workflowName,
    );
    return {
      instruction: normalized,
      changed: normalized !== raw,
      warnings: normalized !== raw
        ? ['已根据关联工作流生成标准执行指令']
        : warnings,
    };
  }

  let normalized = raw;
  const hadMetaIntent = detectMetaScheduledTaskIntent(normalized);

  normalized = stripSchedulePhrases(normalized);
  normalized = stripMetaTaskPhrases(normalized);
  normalized = stripTrailingTaskSuffix(normalized);
  normalized = collapseWhitespace(normalized);

  if (!normalized) {
    normalized = raw;
    warnings.push('无法自动提取执行内容，已保留原始描述');
    return { instruction: normalized, changed: false, warnings };
  }

  if (hadMetaIntent && normalized !== raw) {
    warnings.push('已去除描述中的「创建定时任务」和计划时间表述，仅保留执行动作');
  }

  return {
    instruction: normalized,
    changed: normalized !== raw,
    warnings,
  };
}
