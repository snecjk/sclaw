/**
 * Shared predicate: should this send take the template `sendWithWorkflow` path
 * (getStartupSchema + pendingWorkflow + parameter form), rather than mine-instance
 * bake chat or mixed skill+workflow segment send.
 *
 * `source === 'mine'` → instance / published mine workflow (not this path).
 * Anything else (`'template'`, unset, official install deep-link) → template path
 * when there is exactly one workflow and no skills.
 */
export function isSingleTemplateWorkflowSend(input: {
  workflows: Array<{ id: string; name?: string; source?: string }>;
  skillCount?: number;
}): boolean {
  if ((input.skillCount ?? 0) > 0) return false;
  if (input.workflows.length !== 1) return false;
  return input.workflows[0]?.source !== 'mine';
}
