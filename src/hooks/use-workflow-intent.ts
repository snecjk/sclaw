/**
 * Workflow intent helpers for in-flight UI state (param confirm / session hints).
 *
 * NL creation and template search are handled by the model via `search_workflow_templates`.
 * `/` picker uses `sendWithWorkflow` directly — no keyword routing here.
 */

/** Phrases that trigger start on an existing workflowId (POST start). */
const WORKFLOW_START_PATTERNS = [
  /(?:帮我|请)?.*(?:运行|执行|启动|跑).*(?:这个|该|此|刚才|上次|已有|当前).*(?:工作流|workflow)/i,
  /(?:运行|执行|启动)(?:这个|该|此|刚才|上次)?(?:工作流|workflow)/i,
  /(?:再|重新)(?:运行|执行|启动).*(?:工作流|workflow)/i,
];

/**
 * Imperative command to start/run a saved workflow (POST /workflows/{id}/start).
 * Excludes analytical phrasing like「分析一下工作流的执行情况」.
 */
export function isImperativeWorkflowStartIntent(text: string): boolean {
  if (!text?.trim()) return false;
  return WORKFLOW_START_PATTERNS.some((p) => p.test(text));
}

/**
 * User wants to start/run an already-saved workflow (POST /workflows/{id}/start).
 * Includes imperative commands plus broad「工作流 + 运行/执行」heuristic for session hints.
 */
export function isWorkflowStartIntent(text: string): boolean {
  if (!text?.trim()) return false;
  if (isReExecutionIntent(text)) return true;
  if (isImperativeWorkflowStartIntent(text)) return true;

  const hasWorkflow = /工作流|workflow/i.test(text);
  const hasRunVerb = /运行|执行|启动|跑一遍/i.test(text);
  const hasCreateVerb = /创建|新建|搭建|配置/i.test(text);

  return hasWorkflow && hasRunVerb && !hasCreateVerb;
}

const WORKFLOW_ID_IN_TEXT = /\b(wf_[\w-]+)\b/i;

/** Extract workflow instance id from user text (e.g.「重新执行 wf_68162433」). */
export function extractWorkflowIdFromText(text: string): string | undefined {
  return text.match(WORKFLOW_ID_IN_TEXT)?.[1];
}

/** Text explicitly references a workflow instance or template context. */
export function hasExplicitWorkflowReference(text: string): boolean {
  return /工作流|workflow/i.test(text) || !!extractWorkflowIdFromText(text);
}

/**
 * Check if user message is a cancellation intent during workflow configuration.
 */
export function isWorkflowCancelIntent(text: string): boolean {
  if (!text) return false;
  const cancelPatterns = /(?:取消|不执行|不做了|算了|停止|退出|放弃)/i;
  return cancelPatterns.test(text);
}

/**
 * Check if user message indicates immediate execution without separate confirmation.
 */
export function isImmediateExecutionIntent(text: string): boolean {
  if (!text) return false;
  const immediatePatterns = /(?:创建并执行|创建并运行|直接执行|立即执行|马上执行)/i;
  return immediatePatterns.test(text);
}

/** Non-workflow file/folder creation — must not trigger workflow tool hints. */
const NON_WORKFLOW_CREATE_PATTERN =
  /创建(?:一个)?(?:文件|文件夹|目录|文档|ppt|报告|表格)/i;

/**
 * User wants to create a new workflow instance from a template (NL or named template).
 * Injected as a hidden session hint so the model calls search_workflow_templates, not sai-cli.
 */
export function isWorkflowCreationIntent(text: string): boolean {
  if (!text?.trim()) return false;
  if (isReExecutionIntent(text) || isWorkflowStartIntent(text)) return false;

  const hasWorkflow = /工作流|workflow/i.test(text);
  if (NON_WORKFLOW_CREATE_PATTERN.test(text) && !hasWorkflow) return false;

  if (/(?:创建|新建|搭建|配置|建立)(?:一个)?(?:工作流|workflow)/i.test(text)) return true;
  if (/(?:工作流|workflow)(?:的)?(?:创建|新建|搭建)/i.test(text)) return true;

  const hasCreateVerb = /创建|新建|搭建|配置|建立/i.test(text);
  return hasWorkflow && hasCreateVerb;
}

/** Short re-run phrases without explicit「工作流」wording (e.g.「再执行一下」). */
const SHORT_RERUN_PATTERN = /^再(?:来)?(?:执行|跑|运行|启动)(?:一下|一遍|一次)?[。.!！]?$/i;

/**
 * Check if user message is a re-execution intent for a remembered workflow.
 * Only acted on when session has saved workflow memory or model calls execute_workflow.
 */
export function isReExecutionIntent(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (SHORT_RERUN_PATTERN.test(trimmed)) return true;
  const reExecPatterns =
    /(?:执行刚才的|再跑一遍|再执行(?:一下|一次)?|重新执行|用上次参数|继续执行)|(?:运行|执行|启动)这个(?:工作流|workflow)/i;
  return reExecPatterns.test(trimmed);
}

/**
 * User asks which workflowId/runId exists in the current session.
 * Inject session memory hint so the model can answer or call execute_workflow.
 */
export function isWorkflowSessionLookupIntent(text: string): boolean {
  if (!text?.trim()) return false;
  return /(?:workflow\s*id|workflowId|工作流\s*(?:实例)?\s*(?:id|ID)|(?:找|查|获取).*(?:workflow|工作流).*(?:id|ID)|会话.*(?:workflow|工作流))/i.test(
    text.trim(),
  );
}

/** True when sendMessage should attach saved workflowId/runId session hint for the model. */
export function shouldInjectWorkflowSessionHint(text: string): boolean {
  return (
    isReExecutionIntent(text)
    || isWorkflowStartIntent(text)
    || isWorkflowSessionLookupIntent(text)
  );
}

/** Prompt when user wants to run but no saved workflow exists in session. */
export function buildWorkflowStartUnavailablePrompt(): string {
  return [
    '当前会话没有可运行的工作流记录。',
    '请先通过「创建xxx工作流」完成参数配置，或输入 / 从列表中选择模板。',
  ].join('\n');
}
