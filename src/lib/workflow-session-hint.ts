/**
 * Inject current session workflow memory into user messages so the model
 * can call execute_workflow with the correct workflowId.
 */
import { resolveSessionWorkflowId } from '@/lib/session-workflow-context';
import { getLatestWorkflow, getSessionWorkflows } from '@/stores/workflow-memory';
import type { RawMessage } from '@/stores/chat/types';
import type { WorkflowExecutionState } from '@/types/workflow';

export const WORKFLOW_SESSION_HINT_MARKER = '<!-- StoClaw-Workflow-Session -->';

/**
 * Hidden hint for NL workflow creation — steers model to builtin tools, not sai-cli/exec.
 */
export function buildWorkflowCreationHint(userText: string): string {
  const query = userText.trim();
  return [
    WORKFLOW_SESSION_HINT_MARKER,
    '',
    '## 工作流创建指引',
    '',
    '用户要创建或查找工作流。必须使用 sto-workflow-tool 注册的内置 OpenClaw Tools，按顺序：',
    '1. `search_workflow_templates`（query 取自用户描述中的模板名/关键词）',
    '2. `get_workflow_schema`（选中模板后）',
    '3. `create_workflow`',
    '4. 若需立即运行：`execute_workflow`',
    '',
    '这些 tool 由你在对话中直接调用（OpenClaw 内置 tool 列表），不是 `openclaw` CLI 子命令。',
    '禁止 exec、shell、openclaw CLI、sai-cli、sai-cli discover 或读取 sai-cli SKILL 替代上述内置 tools。',
    '',
    `用户原话：${query}`,
  ].join('\n');
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
  const startIdx = message.indexOf(WORKFLOW_SESSION_HINT_MARKER);
  const endIdx = message.lastIndexOf(WORKFLOW_SESSION_HINT_MARKER);
  if (startIdx >= 0 && endIdx > startIdx) {
    return message.slice(endIdx + WORKFLOW_SESSION_HINT_MARKER.length).trim();
  }
  if (startIdx >= 0) {
    return message.slice(0, startIdx).trim();
  }
  return message;
}
