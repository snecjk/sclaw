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
    '3. **禁止** `create_workflow`：get_workflow_schema 后客户端会弹出参数表单，用户填写并提交后由客户端创建并启动',
    '4. 引导用户在参数表单中逐步确认参数，不要用默认值直接创建',
    '5. get_workflow_schema 后：在回复末尾单独一行输出 `<ParameterForm templateId="模板id" schemaHash="schemaHash" />`（templateId/schemaHash 取自工具结果）',
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
    '用户可能要重新执行或启动上述工作流。请使用内置工具 `execute_workflow`，传入 JSON 中的 `workflowId`（及可选 `inputs`）。',
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
