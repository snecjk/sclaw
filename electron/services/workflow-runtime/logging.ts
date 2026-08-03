import { debug, error, info, warn } from '../../utils/logger';

type WorkflowLogLevel = 'debug' | 'info' | 'warn' | 'error';

type WorkflowLogFields = Record<string, unknown>;

const writers = { debug, info, warn, error };

export function workflowExecLog(
  level: WorkflowLogLevel,
  phase: string,
  message: string,
  fields: WorkflowLogFields = {},
): void {
  const fieldText = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `[${key}=${formatWorkflowLogValue(value)}]`)
    .join('');
  writers[level](`[workflow-exec][phase=${phase}]${fieldText} ${message}`);
}

function formatWorkflowLogValue(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
