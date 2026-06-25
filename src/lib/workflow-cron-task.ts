export function buildWorkflowCronTaskMessage(workflowId: string): string {
  return `执行 ${workflowId} 工作流`;
}
