/**
 * Restore workflow execution state from Gateway session history (raw tool results).
 * Used after app reinstall when localStorage is empty but .jsonl transcripts remain.
 */
import type { WorkflowExecutionSessionRecord } from '../../shared/workflow-session-record';
import { parseStoToolEnvelope, type WorkflowExecutionStartedData } from '@/lib/builtin-tool-envelope';
import { isToolResultRole } from '@/stores/chat/helpers';
import type { RawMessage } from '@/stores/chat/types';
import {
  getExecutionByRunId,
  getSessionWorkflows,
  saveWorkflowExecution,
  saveWorkflowRecord,
  sessionHasWorkflowExecution,
  type WorkflowExecutionRecord,
} from '@/stores/workflow-memory';

export interface WorkflowExecutionHistoryHint {
  templateId?: string;
  templateName?: string;
  workflowId: string;
  runId: string;
  status: WorkflowExecutionRecord['status'];
  paramsSummary?: string;
  collectedInputs?: Record<string, unknown>;
  phase?: WorkflowExecutionSessionRecord['data']['phase'];
  source: 'execution_record' | 'execution_started' | 'run_status';
  timestampMs: number;
}

function mapApiStatusToLocal(status: string | undefined): WorkflowExecutionRecord['status'] {
  switch (status) {
    case 'succeeded':
    case 'completed':
      return 'completed';
    case 'failed':
    case 'error':
      return 'failed';
    case 'timeout':
    case 'timed_out':
      return 'timeout';
    case 'running':
    case 'pending':
      return 'running';
    default:
      return 'unknown';
  }
}

function hintFromExecutionRecord(
  envelope: WorkflowExecutionSessionRecord,
  timestampMs: number,
): WorkflowExecutionHistoryHint {
  const data = envelope.data;
  return {
    templateId: data.templateId,
    templateName: data.templateName,
    workflowId: data.workflowId,
    runId: data.runId,
    status: data.status,
    paramsSummary: data.paramsSummary,
    collectedInputs: data.collectedInputs,
    phase: data.phase,
    source: 'execution_record',
    timestampMs,
  };
}

function hintFromExecutionStarted(
  data: WorkflowExecutionStartedData,
  timestampMs: number,
): WorkflowExecutionHistoryHint {
  return {
    templateName: data.templateName,
    workflowId: data.workflowId,
    runId: data.runId,
    status: mapApiStatusToLocal(data.status),
    source: 'execution_started',
    timestampMs,
  };
}

function hintFromRunStatus(
  data: Record<string, unknown>,
  timestampMs: number,
): WorkflowExecutionHistoryHint | null {
  const runId = typeof data.id === 'string' ? data.id : undefined;
  const workflowId = typeof data.workflowId === 'string' ? data.workflowId : undefined;
  if (!runId || !workflowId) return null;

  return {
    workflowId,
    runId,
    status: mapApiStatusToLocal(typeof data.status === 'string' ? data.status : undefined),
    source: 'run_status',
    timestampMs,
  };
}

function messageTimestampMs(msg: RawMessage): number {
  const ts = msg.timestamp;
  if (typeof ts === 'number' && ts > 0) {
    return ts < 1e12 ? ts * 1000 : ts;
  }
  return 0;
}

/** Scan raw history (including tool_result rows) for workflow execution hints. */
export function extractWorkflowExecutionsFromHistory(
  rawMessages: RawMessage[],
): WorkflowExecutionHistoryHint[] {
  const byRunId = new Map<string, WorkflowExecutionHistoryHint>();

  for (const msg of rawMessages) {
    if (!isToolResultRole(msg.role)) continue;

    const envelope = parseStoToolEnvelope(msg.content);
    if (!envelope) continue;

    const ts = messageTimestampMs(msg) || Date.now();
    let hint: WorkflowExecutionHistoryHint | null = null;

    if (envelope.type === 'workflow_execution_record' && envelope.data) {
      hint = hintFromExecutionRecord(envelope as WorkflowExecutionSessionRecord, ts);
    } else if (envelope.type === 'workflow_execution_started' && envelope.success && envelope.data) {
      hint = hintFromExecutionStarted(envelope.data as WorkflowExecutionStartedData, ts);
    } else if (envelope.type === 'workflow_run_status' && envelope.success && envelope.data) {
      hint = hintFromRunStatus(envelope.data as Record<string, unknown>, ts);
    }

    if (!hint?.runId) continue;

    const existing = byRunId.get(hint.runId);
    if (!existing) {
      byRunId.set(hint.runId, hint);
      continue;
    }

    // Prefer execution_record > terminal run_status > started
    const rank = (h: WorkflowExecutionHistoryHint): number => {
      if (h.source === 'execution_record' && (h.phase === 'completed' || h.phase === 'failed')) return 4;
      if (h.source === 'execution_record') return 3;
      if (h.source === 'run_status' && (h.status === 'completed' || h.status === 'failed')) return 2;
      if (h.source === 'execution_started') return 1;
      return 0;
    };

    if (rank(hint) >= rank(existing) || hint.timestampMs >= existing.timestampMs) {
      byRunId.set(hint.runId, { ...existing, ...hint, timestampMs: Math.max(existing.timestampMs, hint.timestampMs) });
    }
  }

  return [...byRunId.values()].sort((a, b) => a.timestampMs - b.timestampMs);
}

export function findLatestSchemaReadyTemplateId(rawMessages: RawMessage[]): string | undefined {
  for (let i = rawMessages.length - 1; i >= 0; i--) {
    const msg = rawMessages[i];
    if (!isToolResultRole(msg.role)) continue;
    const envelope = parseStoToolEnvelope(msg.content);
    if (envelope?.type !== 'workflow_schema_ready' || !envelope.success) continue;
    const templateId = (envelope.data as { templateId?: string } | undefined)?.templateId;
    if (templateId) return templateId;
  }
  return undefined;
}

/** True when workflow_schema_ready should NOT re-open the parameter form. */
export function shouldSkipWorkflowSchemaAbsorb(
  rawMessages: RawMessage[],
  sessionKey: string,
): boolean {
  const hints = extractWorkflowExecutionsFromHistory(rawMessages);
  const schemaTemplateId = findLatestSchemaReadyTemplateId(rawMessages);

  if (schemaTemplateId) {
    if (sessionHasWorkflowExecution(sessionKey, schemaTemplateId)) return true;
    const matched = hints.filter((h) => h.templateId === schemaTemplateId || !h.templateId);
    if (matched.some((h) => h.status !== 'pending' && h.status !== 'unknown')) return true;
  }

  if (hints.length > 0 && sessionHasWorkflowExecution(sessionKey)) return true;

  // Any persisted execution record in jsonl means this session already progressed past the form.
  if (hints.some((h) => h.source === 'execution_record')) return true;

  return false;
}

/** Seed localStorage workflow memory from jsonl hints (no-op when already present). */
export function seedWorkflowMemoryFromHistory(
  hints: WorkflowExecutionHistoryHint[],
  sessionKey: string,
): void {
  for (const hint of hints) {
    if (!hint.runId || !hint.workflowId) continue;
    if (getExecutionByRunId(hint.runId, sessionKey)) continue;

    const createdAt = hint.timestampMs || Date.now();
    saveWorkflowExecution({
      sessionKey,
      workflowId: hint.workflowId,
      runId: hint.runId,
      templateId: hint.templateId ?? '',
      templateName: hint.templateName ?? hint.workflowId,
      status: hint.status,
      createdAt,
      updatedAt: createdAt,
      collectedInputs: hint.collectedInputs ?? {},
      paramsSummary: hint.paramsSummary,
    });

    if (hint.templateId) {
      const existingWorkflow = getSessionWorkflows(sessionKey).find(
        (w) => w.workflowId === hint.workflowId,
      );
      if (!existingWorkflow) {
        saveWorkflowRecord(sessionKey, {
          workflowId: hint.workflowId,
          templateId: hint.templateId,
          templateName: hint.templateName ?? hint.templateId,
          schemaHash: '',
          collectedInputs: hint.collectedInputs ?? {},
          createdAt,
          lastRunId: hint.runId,
          lastStatus: hint.status,
        });
      }
    }
  }
}
