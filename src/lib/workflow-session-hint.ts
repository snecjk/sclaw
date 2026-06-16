/**
 * Inject current session workflow memory into user messages so the model
 * can call execute_workflow with the correct workflowId.
 */
import { resolveSessionWorkflowId } from '@/lib/session-workflow-context';
import { stripWorkflowContextForDisplay } from '@/lib/workflow-context';
import { getLatestWorkflow, getSessionWorkflows } from '@/stores/workflow-memory';
import type { RawMessage } from '@/stores/chat/types';
import type { WorkflowExecutionState } from '@/types/workflow';

export const WORKFLOW_SESSION_HINT_MARKER = '<!-- StoClaw-Workflow-Session -->';

export interface WorkflowCreationTemplateHint {
  id: string;
  label: string;
  description?: string;
}

/** Strip workflow-creation boilerplate; keep template name keywords for POST /workflow-templates. */
export function extractWorkflowSearchQuery(userText: string): string {
  const trimmed = userText.trim();
  const stripped = trimmed
    .replace(/(?:帮我|请|给我)/g, '')
    .replace(/(?:创建|新建|搭建|配置|建立)(?:一个)?(?:工作流|workflow)?/gi, '')
    .replace(/(?:工作流|workflow)(?:的)?(?:创建|新建|搭建)/gi, '')
    .trim();
  return stripped || trimmed;
}

/**
 * Hidden hint for NL workflow creation — steers model to builtin tools, not sai-cli/exec.
 */
export function buildWorkflowCreationHint(
  userText: string,
  templates?: WorkflowCreationTemplateHint[],
): string {
  const query = extractWorkflowSearchQuery(userText);
  const lines = [
    WORKFLOW_SESSION_HINT_MARKER,
    '',
    '## 工作流创建指引',
    '',
    '用户要创建或查找工作流。必须使用 sto-workflow-tool 内置 OpenClaw Tools：',
    '1. `search_workflow_templates`（POST /agent/v1/workflow-templates，query 取模板关键词）',
    '2. `get_workflow_schema`（传 templates[].id；或直接传 query 自动搜索模板）',
    '3. **禁止** `create_workflow`：get_workflow_schema 后客户端会**自动弹出分步参数表单**，用户填写并提交后由客户端创建并启动',
    '4. get_workflow_schema 后：**停止调用工具**；正文最多 3～5 句业务说明（用 schema 的 confirm 步骤标题），引导用户在下方表单逐步确认',
    '5. **禁止**在对话中输出：字段 key/常量名、参数对照表、Markdown 表格、默认值列表',
    '6. ParameterForm 标记可由客户端自动注入；若需手写，仅在回复末尾单独一行：`<ParameterForm templateId="..." schemaHash="..." />`',
    '',
    '禁止 exec、shell、openclaw CLI、sai-cli 或读取 sai-cli SKILL 替代上述内置 tools。',
  ];

  if (templates?.length) {
    lines.push('', '## 已预搜索模板（POST /agent/v1/workflow-templates）', '');
    for (const item of templates.slice(0, 5)) {
      lines.push(`- templateId=${item.id} label=${item.label}`);
    }
    lines.push(
      '',
      `推荐下一步：get_workflow_schema({ "templateId": "${templates[0].id}" })`,
      `或：get_workflow_schema({ "query": "${query}" })`,
    );
  }

  lines.push('', `用户原话：${userText.trim()}`, `搜索关键词：${query}`);
  return lines.join('\n');
}

export function buildWorkflowSessionHint(
  sessionKey: string,
  messages: RawMessage[],
  workflowCardStates: Record<string, WorkflowExecutionState>,
): string | null {
  const latest = getLatestWorkflow(sessionKey);
  const workflowId = resolveSessionWorkflowId(sessionKey, messages, workflowCardStates)
    ?? latest?.workflowId;
  if (!workflowId) return null;

  const remembered = getSessionWorkflows(sessionKey).find((w) => w.workflowId === workflowId);
  const payload = {
    version: 1,
    source: 'stoclaw-workflow-session',
    workflowId,
    templateId: remembered?.templateId ?? latest?.templateId,
    templateName: remembered?.templateName ?? latest?.templateName,
    collectedInputs: remembered?.collectedInputs ?? latest?.collectedInputs ?? {},
    lastRunId: remembered?.lastRunId ?? latest?.lastRunId,
  };

  return [
    WORKFLOW_SESSION_HINT_MARKER,
    '',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    '',
    '## 当前会话工作流上下文',
    '',
    '上述 JSON 为客户端在用户提交参数表单后创建的工作流实例（`workflowId` 以 `wf_` 开头；`lastRunId` 为最近一次运行）。',
    '用户若要重新执行、查找 workflowId、或继续上次参数：请使用内置工具 `execute_workflow`，传入 `workflowId`（及可选 `inputs`）。',
    '禁止 exec、sai-cli 或虚构 CLI 命令。',
  ].join('\n');
}

export function appendWorkflowSessionHint(text: string, hint: string | null): string {
  if (!hint || text.includes(WORKFLOW_SESSION_HINT_MARKER)) return text;
  return `${hint}\n${WORKFLOW_SESSION_HINT_MARKER}\n${text}`;
}

export function stripWorkflowSessionHintForDisplay(message: string): string {
  if (!message.includes(WORKFLOW_SESSION_HINT_MARKER)) return message;
  const parts = message.split(WORKFLOW_SESSION_HINT_MARKER);
  // appendWorkflowSessionHint: marker + hint + marker + user text
  if (parts.length >= 3) {
    return parts.slice(2).join(WORKFLOW_SESSION_HINT_MARKER).trim();
  }
  return parts[parts.length - 1]?.trim() || message;
}

/** User-visible session title from gateway user message (strips injected hints). */
export function deriveSessionLabelFromUserText(rawText: string): string {
  return stripWorkflowContextForDisplay(stripWorkflowSessionHintForDisplay(rawText)).trim();
}

export function isCorruptedSessionLabel(label: string): boolean {
  return label.includes('<!-- StoClaw-Workflow') || label.includes('## 工作流');
}
