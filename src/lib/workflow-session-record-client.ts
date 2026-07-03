/**
 * Renderer client for persisting workflow execution records to session .jsonl.
 */
import { invokeIpc } from '@/lib/api-client';
import type { WorkflowExecutionSessionRecord } from '../../shared/workflow-session-record';

export type AppendWorkflowSessionRecordInput = WorkflowExecutionSessionRecord['data'];

/** Fire-and-forget append; failures are logged but do not block UI. */
export function appendWorkflowSessionRecord(input: AppendWorkflowSessionRecordInput): void {
  void invokeIpc('workflow:appendSessionRecord', input).catch((err) => {
    console.warn('[workflow-session-record] append failed', err);
  });
}
