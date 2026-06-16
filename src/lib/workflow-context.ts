/**
 * Workflow Context Injection Utilities
 *
 * Injects hidden workflow schema context into user messages so the AI can
 * guide parameter confirmation naturally. The injected block is stripped
 * before display in the chat UI.
 */
import { buildWorkflowParameterModelGuidanceFromSteps } from '@/lib/workflow-form-utils';
import type { WorkflowContextBlock } from '@/stores/chat/types';

export const WORKFLOW_CONTEXT_MARKER = '<!-- StoClaw-Workflow-Context -->';

export function messageHasWorkflowContext(message: string): boolean {
  return message.includes(WORKFLOW_CONTEXT_MARKER);
}

/**
 * Build the human-readable + machine-readable workflow context block.
 */
export function buildWorkflowContextText(context: WorkflowContextBlock): string {
  const confirmSteps = context.confirmSteps?.length
    ? context.confirmSteps
    : context.fields.map((f) => f.label);
  const guidance = buildWorkflowParameterModelGuidanceFromSteps(
    context.templateName,
    confirmSteps,
  );

  return [
    WORKFLOW_CONTEXT_MARKER,
    '',
    '```json',
    JSON.stringify(
      {
        version: 2,
        source: 'stoclaw-workflow-context',
        templateId: context.templateId,
        templateName: context.templateName,
        schemaHash: context.schemaHash,
        confirmSteps: context.confirmSteps ?? [],
      },
      null,
      2,
    ),
    '```',
    '',
    guidance,
    '',
    '```',
    '<ParameterForm templateId="' + context.templateId + '" schemaHash="' + context.schemaHash + '" />',
    '```',
  ].join('\n');
}

/**
 * Append workflow context to the user message text.
 */
export function appendWorkflowContext(text: string, context?: WorkflowContextBlock | null): string {
  if (!context) return text;
  if (messageHasWorkflowContext(text)) return text;
  const ctxText = buildWorkflowContextText(context);
  return `${ctxText}\n${WORKFLOW_CONTEXT_MARKER}\n${text}`;
}

export const WORKFLOW_COMPLETE_TAG = '[workflow:complete]';

/**
 * Strip injected workflow context blocks for chat UI display.
 */
export function stripWorkflowContextForDisplay(message: string): string {
  if (!messageHasWorkflowContext(message)) return message;

  const startMarker = WORKFLOW_CONTEXT_MARKER;
  const startIdx = message.indexOf(startMarker);
  const endIdx = message.lastIndexOf(startMarker);

  if (startIdx >= 0 && endIdx > startIdx) {
    const after = message.slice(endIdx + startMarker.length).trim();
    return after;
  }

  if (startIdx >= 0) {
    return message.slice(0, startIdx).trim();
  }

  return message;
}

/**
 * Simplify the structured [workflow:complete] user message for display.
 */
export function stripWorkflowCompleteForDisplay(message: string): string {
  if (!message.includes(WORKFLOW_COMPLETE_TAG)) return message;
  return '';
}
