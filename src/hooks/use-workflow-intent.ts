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
 * User wants to start/run an already-saved workflow (POST /workflows/{id}/start).
 */
export function isWorkflowStartIntent(text: string): boolean {
  if (!text?.trim()) return false;
  if (isReExecutionIntent(text)) return true;
  if (WORKFLOW_START_PATTERNS.some((p) => p.test(text))) return true;

  const hasWorkflow = /工作流|workflow/i.test(text);
  const hasRunVerb = /运行|执行|启动|跑一遍/i.test(text);
  const hasCreateVerb = /创建|新建|搭建|配置/i.test(text);

  return hasWorkflow && hasRunVerb && !hasCreateVerb;
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

/**
 * Check if user message is a re-execution intent for a remembered workflow.
 * Only acted on when session has saved workflow memory or model calls execute_workflow.
 */
export function isReExecutionIntent(text: string): boolean {
  if (!text) return false;
  const reExecPatterns = /(?:执行刚才的|再跑一遍|再执行一次|重新执行|用上次参数|继续执行)|(?:运行|执行|启动)这个(?:工作流|workflow)/i;
  return reExecPatterns.test(text);
}

/** Prompt when user wants to run but no saved workflow exists in session. */
export function buildWorkflowStartUnavailablePrompt(): string {
  return [
    '当前会话没有可运行的工作流记录。',
    '请先通过「创建xxx工作流」完成参数配置，或输入 / 从列表中选择模板。',
  ].join('\n');
}
