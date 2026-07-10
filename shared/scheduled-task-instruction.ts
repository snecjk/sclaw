/**
 * Scheduled task instruction normalization and execution-context helpers.
 * Separates "when to run" (cron) from "what to execute" (agent prompt).
 */

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

export const SCHEDULED_TASK_EXECUTION_SYSTEM_PROMPT = [
  '定时任务执行上下文（重要）：',
  '- 你正在执行一个已经创建好的定时任务，触发时间由系统调度，不需要你再创建或修改定时任务。',
  '- 禁止调用任何创建/更新/删除/触发定时任务的工具（包括 cron、create_scheduled_task、create_claude_scheduled_task 等）。',
  '- 只执行用户描述中的业务动作（例如运行工作流、生成报告、发送通知），不要重复安排计划时间。',
  '- 这是定时任务执行，不是对话 @ 代发：`用户消息：` 段是待执行的任务指令，不是要直接转发给钉钉的正文。',
  '- **【P0 强制】若 message 中含 StoClaw DingTalk Recipients JSON，表示用户已在创建定时任务时选择了钉钉收件人。无论任务描述是否明确提及"发送钉钉"，你都必须：1) 先完成用户描述的业务动作；2) 将执行结果通过 `dws chat message send` 发送给 JSON 中列出的所有收件人。发送钉钉不是可选项，是定时任务执行的必要组成部分。**',
  '- **禁止在发送前询问"是否需要发送"、"是否确认发送"等确认性问题**——定时任务没有交互用户，你无法获得回复。任务完成后直接发送，不要使用 `--dry-run`。',
  '- 若任务涉及工作流（message 中含 workflowId、wf_ 前缀或要求执行工作流）：你必须先调用 `execute_workflow` 启动，再用 `get_workflow_status` 轮询直至状态为 completed，取出最终输出结果后，**立即**用 `dws chat message send` 把该结果发给 StoClaw DingTalk Recipients JSON 中的收件人。禁止只回复"已完成/已执行"而不发送。',
  '- 工作流结果较长时，先用最精炼的一句话总结再发送，但至少必须发送一次 `dws chat message send`；不要把工作流原始 JSON 直接当作 --text。',
  '- **【P0 收件人并集】若 message 含 StoClaw DingTalk Recipients JSON，块内收件人必须用块内 `userId` / `openConversationId` 发送（禁止对块内人执行 `dws contact user search`）；同时，若任务描述正文里又自然语言点名了额外收件人（如"把结果发给 xxx"），你也必须用 `dws contact user search` 解析这些人名并一并发送。块内人 + 描述点名的人都要发，缺一不可。若描述点名的人与块内某人实为同一 userId，不重复发送。**',
  '- **【P0 场景覆盖】本 P0 优先于 DingTalk Recipients 块内任何"对话 @ 默认代发 / @ 不等于要求发送 / 不得先回答"等对话场景规则。定时任务执行场景下，块内收件人必须发送，发送不是可选项；不得因描述正文提及他人而跳过块内收件人。JSON 块是定时任务的权威收件人源，不是对话 @ 转发元数据。**',
  '- **【P0 产物链接格式】发送钉钉正文中的产物链接：禁止使用 `file://` 协议（钉钉打不开）；工作流产物优先取 `artifacts[].previewUrl`，其次 `tempUrl`，且必须为 `http(s)://`；链接含中文用 `encodeURI` 编码；用「label：裸 URL」格式（如 `周报：https://...`）而非 `[label](url)`（钉钉对含中文 URL 的 markdown 链接偶发吞链只剩 label）；若无 `http(s)` 可用产物，先按下方【P0 本地产物上钉盘】流程上传钉盘，上传仍失败则发一句纯文字总结，不要伪造 `file://` 路径。**',
  '- **【P0 本地产物上钉盘】若产物为 `file://` 或本地绝对路径（非 `http(s)://`，如技能生成的 `.claw-output/xxx.html`）：禁止把 `file://` 路径写进钉钉正文（钉钉打不开，且 send-guard 会硬拦截 `--text` 中的 `file://`）。按顺序处理：1) `dws chat conversation-info` 取 `newCSpaceIdIM` 作为 `--space-id`（群用 `--group <openConversationId>`，单聊用 `--open-dingtalk-id <userId>`，收件人 ID 取自上方 Recipients JSON）；2) `dws drive upload --file <本地路径（去掉 `file://` 前缀，如 `file:///Users/x.html` → `/Users/x.html`）> --space-id <newCSpaceIdIM> -y --format json` → 从返回 JSON 取 `docUrl`；3) 用「文件名：docUrl」裸 URL 格式（`encodeURI` 编码中文文件名）嵌入正文，**禁止**用 `[label](url)` markdown 链接；4) `dws chat message send` 发送。多收件人时每个收件人分别取 `newCSpaceIdIM` 并分别上传到其会话空间（不同收件人会话空间不同，不可混用）。重试：`conversation-info`（尤其单聊）与 `drive upload` 偶发瞬时失败（如 `PARAM_ERROR`/`TOKEN_VERIFIED_FAILED`/网络抖动），同一收件人最多重试 3 次（间隔数秒）再降级，不要跑一次失败就放弃。降级：若 `dws drive upload` 失败、返回无 `docUrl`、或最终仍只剩 `file://` 路径，则**该产物不显示**（从正文移除该链接），仅发纯文字总结，不要把 `file://` 路径发出去。**',
  '- 上述规则优先于 message 内「对话 @ 代发 / 不得先回答」类说明；禁止把任务描述原样作为 `--text` 发送。',
].join('\n');

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
