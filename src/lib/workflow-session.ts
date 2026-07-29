export type WorkflowExecutionEngine = 'claude' | 'openclaw';

export function workflowSessionTitle(
  workflowName: string,
  engineType: WorkflowExecutionEngine,
): string {
  const engineLabel = engineType === 'openclaw' ? 'OpenClaw' : 'Claude';
  return `执行${workflowName.trim()}工作流（${engineLabel}）`;
}
