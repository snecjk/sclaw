/**
 * Inject current session workflow memory into user messages so the model
 * can call execute_workflow with the correct workflowId.
 */
import {
  messageHasDingTalkRecipientContext,
  stripDingTalkMentionContextForDisplay,
} from '@/lib/dingtalk-mention-context';
import { resolveSessionWorkflowId } from '@/lib/session-workflow-context';
import { stripWorkflowContextForDisplay } from '@/lib/workflow-context';
import { getLatestWorkflow, getSessionWorkflows } from '@/stores/workflow-memory';
import type { RawMessage } from '@/stores/chat/types';
import type { WorkflowExecutionState } from '@/types/workflow';

export const WORKFLOW_SESSION_HINT_MARKER = '<!-- StoClaw-Workflow-Session -->';

/** Kept in sync with SKILL_MARKER_RE in skill-transcript-marker.ts (local copy avoids a circular import). */
const SKILL_TRANSCRIPT_MARKER_RE = /<!--\s*SClaw-Skill\s+(\{[\s\S]*?\})\s*-->/;

/** Remove the persisted SClaw-Skill transcript marker before deriving a human title. */
function stripSkillTranscriptMarkerForLabel(text: string): string {
  return text.replace(SKILL_TRANSCRIPT_MARKER_RE, '').trimEnd();
}

/**
 * The body around the marker is the injected defaultPrompt, which users never see —
 * the skill name they recognize only exists inside the marker payload.
 */
function readSkillTranscriptLabel(text: string): string | undefined {
  const match = SKILL_TRANSCRIPT_MARKER_RE.exec(text);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1]) as { slug?: string; title?: string; userText?: string };
    const slug = parsed.slug?.trim();
    if (!slug) return undefined;
    return parsed.userText?.trim() || parsed.title?.trim() || slug;
  } catch {
    return undefined;
  }
}

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
    '1. `search_workflow_templates`（POST /agent/v1/workflow-templates，仅返回官方推荐模板，query 取模板关键词）',
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
  const subagentTask = extractSubagentTaskLabel(rawText);
  if (subagentTask) return subagentTask;
  const skillLabel = readSkillTranscriptLabel(rawText);
  if (skillLabel) return skillLabel;
  const stripped = stripDingTalkMentionContextForDisplay(
    stripWorkflowContextForDisplay(
      stripWorkflowSessionHintForDisplay(stripSkillTranscriptMarkerForLabel(rawText)),
    ),
  ).trim();
  if (isSubagentInjectedUserText(stripped)) return '';
  return stripped;
}

const SUBAGENT_CONTEXT_PREFIX = /^\[Subagent Context\]/im;

/** OpenClaw subagent sessions use keys like `agent:main:subagent:<uuid>`. */
export function isSubagentSessionKey(sessionKey: string): boolean {
  return /^agent:[^:]+:subagent:/.test(sessionKey);
}

/** True when the user-role message is OpenClaw's subagent kickoff injection. */
export function isSubagentInjectedUserText(rawText: string): boolean {
  return SUBAGENT_CONTEXT_PREFIX.test(rawText.trim());
}

/** Sidebar/title labels that only contain subagent boilerplate should be re-derived. */
export function isSubagentContextOnlyLabel(label: string): boolean {
  const trimmed = label.trim();
  if (!trimmed) return false;
  return /^\[Subagent Context\]/i.test(trimmed)
    || /^You are running as a subagent/i.test(trimmed);
}

/** Extract delegated task text from OpenClaw's subagent initial user message. */
export function extractSubagentTaskLabel(rawText: string): string | undefined {
  const text = rawText.trim();
  if (!text) return undefined;

  const taskSection = text.match(/\[Subagent Task\]\s*:?\s*\n([\s\S]*?)(?:\n\nBegin\.|\nBegin\.|$)/i);
  if (taskSection?.[1]?.trim()) {
    return taskSection[1].trim();
  }

  if (isSubagentInjectedUserText(text)) {
    return undefined;
  }

  return undefined;
}

export interface DeriveSessionLabelOptions {
  sessionKey?: string;
  gatewayLabel?: string;
  spawnedBy?: string;
  sessionLabels?: Record<string, string>;
  sessions?: Array<{ key: string; label?: string }>;
}

function resolveKnownSessionLabel(
  sessionKey: string,
  sessionLabels: Record<string, string>,
  sessions: Array<{ key: string; label?: string }>,
): string | undefined {
  const stored = sessionLabels[sessionKey]?.trim();
  if (stored && !isCorruptedSessionLabel(stored) && !isPlaceholderSessionLabel(stored)) return stored;

  const session = sessions.find((entry) => entry.key === sessionKey);
  const gatewayLabel = session?.label?.trim();
  if (gatewayLabel && !isCorruptedSessionLabel(gatewayLabel) && !isPlaceholderSessionLabel(gatewayLabel)) {
    return gatewayLabel;
  }

  return undefined;
}

/** Derive a human title from history, skipping injected subagent/system user turns. */
export function deriveSessionLabelFromHistory(
  messages: Array<{ role: string; content?: unknown }>,
  getMessageText: (content: unknown) => string,
  options: DeriveSessionLabelOptions = {},
): string | undefined {
  const gatewayLabel = options.gatewayLabel?.trim();
  if (gatewayLabel && !isCorruptedSessionLabel(gatewayLabel) && !isPlaceholderSessionLabel(gatewayLabel)) {
    return gatewayLabel;
  }

  for (const message of messages) {
    if (message.role !== 'user') continue;
    const rawText = getMessageText(message.content);
    const subagentTask = extractSubagentTaskLabel(rawText);
    if (subagentTask) return subagentTask;

    const derived = deriveSessionLabelFromUserText(rawText);
    if (derived) return derived;
  }

  const parentKey = options.spawnedBy?.trim();
  if (parentKey && options.sessionLabels && options.sessions) {
    return resolveKnownSessionLabel(parentKey, options.sessionLabels, options.sessions);
  }

  return undefined;
}

export function truncateSessionLabel(label: string, maxLength = 50): string {
  const trimmed = label.trim();
  if (!trimmed) return '';
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
}

/** True when `label` is a sidebar title produced by `truncateSessionLabel`, not the full user prompt. */
export function isTruncatedDerivedSessionLabel(label: string, maxLength = 50): boolean {
  const trimmed = label.trim();
  if (!trimmed) return false;
  if (trimmed.endsWith('…') && trimmed.length === maxLength + '…'.length) return true;
  return trimmed.endsWith('...') && trimmed.length >= maxLength;
}

/** Drop injected/system titles before persisting to sessionLabels. */
export function normalizeDerivedSessionLabel(label: string | undefined): string | undefined {
  const trimmed = label?.trim();
  if (!trimmed || isCorruptedSessionLabel(trimmed) || isPlaceholderSessionLabel(trimmed)) {
    return undefined;
  }
  const truncated = truncateSessionLabel(trimmed);
  return truncated || undefined;
}

export function isCorruptedSessionLabel(label: string): boolean {
  return label.includes('<!-- StoClaw-Workflow')
    || label.includes('<!-- SClaw-Skill')
    || label.includes('## 工作流')
    || messageHasDingTalkRecipientContext(label)
    || isSubagentContextOnlyLabel(label);
}

/** Default title before the first user message is derived — not a real session title. */
const PLACEHOLDER_SESSION_LABELS = new Set([
  '新对话',
  'New Chat',
  '新しいチャット',
]);

export function isPlaceholderSessionLabel(label: string): boolean {
  const trimmed = label.trim();
  if (!trimmed) return true;
  return PLACEHOLDER_SESSION_LABELS.has(trimmed);
}
