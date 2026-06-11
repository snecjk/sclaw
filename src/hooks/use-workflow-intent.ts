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

/**
 * Check if user message is a re-execution intent for a remembered workflow.
 * Only acted on when session has saved workflow memory or model calls execute_workflow.
 */
export function isReExecutionIntent(text: string): boolean {
  if (!text) return false;
  const reExecPatterns = /(?:执行刚才的|再跑一遍|再执行一次|重新执行|用上次参数|继续执行)|(?:运行|执行|启动)这个(?:工作流|workflow)/i;
  return reExecPatterns.test(text);
}
