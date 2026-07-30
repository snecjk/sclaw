import {
  buildWorkflowValuesSummary,
  buildWorkflowValuesSummaryFallback,
} from '@/lib/workflow-form-utils';

/** Build parameter summary text when schema is available at submit time. */
export function buildWorkflowStartUserText(
  schema: import('@/types/workflow').WorkflowSchema | undefined,
  values: Record<string, unknown>,
): string {
  if (schema) return buildWorkflowValuesSummary(schema, values);
  return buildWorkflowValuesSummaryFallback(values);
}
