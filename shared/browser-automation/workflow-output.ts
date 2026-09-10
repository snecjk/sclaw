import type { BrowserAutomationPageObservation, BrowserAutomationValidatorResult } from './types';

/** Payload carried across workflow browser nodes. */
export interface BrowserWorkflowPayload {
  sessionId: string;
  baRunId?: string;
  source?: 'embed' | 'managed';
  embedRuntimeId?: string;
  url?: string;
  title?: string;
  stepsCompleted?: number;
  lastObservation?: BrowserAutomationPageObservation;
  validationResults?: BrowserAutomationValidatorResult[];
  status: 'succeeded' | 'failed' | 'paused';
  error?: string;
}

export const BROWSER_WORKFLOW_NODE_TYPES = [
  'browser_task',
  'browser_validate',
  'browser_human_gate',
] as const;

export type BrowserWorkflowNodeType = typeof BROWSER_WORKFLOW_NODE_TYPES[number];

export const BROWSER_AGENT_ALLOWED_TOOLS = [
  'ba_create_session',
  'ba_observe',
  'ba_act',
  'ba_wait',
  'ba_validate',
  'ba_start_run',
  'ba_find',
  'ba_read_page',
] as const;

export function isBrowserWorkflowNodeType(type: string): type is BrowserWorkflowNodeType {
  return (BROWSER_WORKFLOW_NODE_TYPES as readonly string[]).includes(type);
}

export function wrapBrowserWorkflowPayload(payload: BrowserWorkflowPayload): { browser: BrowserWorkflowPayload } {
  return { browser: payload };
}
