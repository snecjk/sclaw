export type WorkflowExecutionEngine = 'claude' | 'openclaw';

const WORKFLOW_SESSION_TITLE_PATTERN = /^执行.+工作流（(?:Claude|OpenClaw)）$/;

export function workflowSessionTitle(
  workflowName: string,
  engineType: WorkflowExecutionEngine,
): string {
  const engineLabel = engineType === 'openclaw' ? 'OpenClaw' : 'Claude';
  return `执行${workflowName.trim()}工作流（${engineLabel}）`;
}

/** Workflow run titles are navigation metadata, never user-authored chat content. */
export function isWorkflowSessionTitle(value: string): boolean {
  return WORKFLOW_SESSION_TITLE_PATTERN.test(value.trim());
}
