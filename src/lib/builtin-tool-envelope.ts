/**
 * Parse STO builtin OpenClaw tool result envelopes from toolresult messages.
 * Mirrors sto-plugin/sto-toolkit/envelope.ts (Renderer-safe subset).
 */

export interface StoToolEnvelope<T = unknown> {
  type: string;
  success: boolean;
  domain: string;
  message?: string;
  data?: T;
  error?: { code: string; message: string };
}

export interface WorkflowExecutionStartedData {
  workflowId: string;
  runId: string;
  status?: string;
  templateName?: string;
  startedAt?: string;
}

export interface WorkflowTemplatesFoundData {
  query: string;
  templates: Array<{
    id: string;
    label: string;
    description?: string;
    matchScore?: number;
  }>;
}

export interface WorkflowSchemaReadyData {
  templateId: string;
  schemaHash: string;
  schema: import('@/types/workflow').WorkflowSchema;
}

export interface WorkflowCreatedData {
  workflowId: string;
  workflowName?: string;
  templateId: string;
  schemaHash: string;
  values?: Record<string, unknown>;
}

export interface ScheduledTaskConfirmationData {
  type: 'scheduled_task_confirmation';
  success?: boolean;
  extractedParams?: {
    name?: string;
    cronExpr?: string;
    description?: string;
    notifyMode?: string;
  };
}

/** Extract JSON text from tool result content (string or content blocks). */
export function extractToolResultText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (block && typeof block === 'object') {
      if ('text' in block && typeof block.text === 'string') return block.text;
      if ('content' in block && typeof block.content === 'string') return block.content;
    }
  }
  return null;
}

export function parseStoToolEnvelope<T = unknown>(content: unknown): StoToolEnvelope<T> | null {
  const text = extractToolResultText(content);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as StoToolEnvelope<T>;
    if (typeof parsed?.type !== 'string' || typeof parsed?.success !== 'boolean') return null;
    return parsed;
  } catch {
    return null;
  }
}
