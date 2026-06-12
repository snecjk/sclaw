/** Branded ID types for STO agent entities. */

export type WorkflowId = string & { readonly __brand: 'WorkflowId' };

export function asWorkflowId(value: string): WorkflowId {
  return value as WorkflowId;
}
