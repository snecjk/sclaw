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
  /** 服务端执行路径返回的版本 ID（用于 getRun hydration 对齐版本）。 */
  versionId?: string | number;
  workflowVersionId?: string | number;
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
  templateName?: string;
  matchedLabel?: string;
}

export interface WorkflowCreatedData {
  workflowId: string;
  workflowName?: string;
  templateId: string;
  schemaHash: string;
  values?: Record<string, unknown>;
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

function isStoToolEnvelope(value: unknown): value is StoToolEnvelope {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as StoToolEnvelope;
  return typeof candidate.type === 'string' && typeof candidate.success === 'boolean';
}

export function parseStoToolEnvelope<T = unknown>(content: unknown): StoToolEnvelope<T> | null {
  if (isStoToolEnvelope(content)) return content as StoToolEnvelope<T>;

  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const details = (content as { details?: unknown }).details;
    if (isStoToolEnvelope(details)) return details as StoToolEnvelope<T>;
  }

  const text = extractToolResultText(content);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as StoToolEnvelope<T>;
    if (!isStoToolEnvelope(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}
