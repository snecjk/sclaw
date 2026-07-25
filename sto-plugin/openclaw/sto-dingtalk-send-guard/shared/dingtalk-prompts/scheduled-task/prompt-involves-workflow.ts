/**
 * Self-contained copy for Gateway extension install (~/.stoclaw/openclaw/extensions/...).
 * Keep in sync with repository root `shared/dingtalk-prompts/scheduled-task/prompt-involves-workflow.ts`.
 * Regenerate: `pnpm run sync:plugin-shared`
 */
const WORKFLOW_ID_RE = /\bwf_[a-zA-Z0-9_-]+\b/;
const WORKFLOW_TOOL_RE = /\b(?:execute_workflow|get_workflow_status)\b/i;

export function promptInvolvesWorkflow(prompt: string | undefined | null): boolean {
  const trimmed = prompt?.trim();
  if (!trimmed) return false;
  if (WORKFLOW_ID_RE.test(trimmed)) return true;
  if (WORKFLOW_TOOL_RE.test(trimmed)) return true;
  if (/workflowId/i.test(trimmed)) return true;
  if (/执行\s*id\s*为/.test(trimmed) && /工作流/.test(trimmed)) return true;
  if (/执行.+工作流/.test(trimmed)) return true;
  return false;
}
