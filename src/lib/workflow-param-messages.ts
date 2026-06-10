/**
 * Upgrade workflow parameter user messages to Chinese labels (schema-driven).
 */
import { buildWorkflowParamsSummary } from '@/lib/workflow-form-utils';
import { getExecutionByRunId, getSessionWorkflows, patchWorkflowExecution } from '@/stores/workflow-memory';
import type { ContentBlock, RawMessage } from '@/stores/chat/types';

function messageText(content: unknown): string {
  return typeof content === 'string' ? content : '';
}

function extractRunId(msg: RawMessage): string | null {
  if (!Array.isArray(msg.content)) return null;
  for (const block of msg.content as ContentBlock[]) {
    if (block.type === 'workflow_card' && block.runId) return block.runId;
  }
  return null;
}

/** Detect legacy/raw parameter bubbles (English keys like check_cycle). */
export function looksLikeRawWorkflowParams(text: string): boolean {
  if (!text.includes('已确认以下参数')) return false;
  return /-\s*[a-z][a-z0-9_]*\s*[:：]/i.test(text);
}

function resolveTemplateId(sessionKey: string, runId: string): string {
  const exec = getExecutionByRunId(runId, sessionKey);
  if (exec?.templateId) return exec.templateId;
  const wf = getSessionWorkflows(sessionKey).find((w) => w.lastRunId === runId);
  return wf?.templateId ?? '';
}

function resolveInputs(sessionKey: string, runId: string): Record<string, unknown> {
  const exec = getExecutionByRunId(runId, sessionKey);
  if (exec?.collectedInputs && Object.keys(exec.collectedInputs).length > 0) {
    return exec.collectedInputs;
  }
  const wf = getSessionWorkflows(sessionKey).find((w) => w.lastRunId === runId);
  return wf?.collectedInputs ?? {};
}

/** Replace raw-key parameter text with schema label summary for workflow turns. */
export async function upgradeWorkflowParamUserMessages(
  messages: RawMessage[],
  sessionKey: string,
): Promise<RawMessage[]> {
  let changed = false;
  const next = [...messages];

  for (let i = 0; i < next.length; i++) {
    const msg = next[i];
    if (msg.role !== 'user') continue;
    const text = messageText(msg.content);
    if (!text.includes('已确认以下参数') && !text.includes('工作流 ID:')) continue;

    const assistant = next[i + 1];
    const runId = assistant ? extractRunId(assistant) : null;
    if (!runId) continue;

    const exec = getExecutionByRunId(runId, sessionKey);
    if (exec?.paramsSummary && !looksLikeRawWorkflowParams(exec.paramsSummary)) {
      if (text !== exec.paramsSummary) {
        next[i] = { ...msg, content: exec.paramsSummary };
        changed = true;
      }
      continue;
    }

    if (!looksLikeRawWorkflowParams(text) && !text.includes('工作流 ID:')) continue;

    const templateId = resolveTemplateId(sessionKey, runId);
    const inputs = resolveInputs(sessionKey, runId);
    const summary = await buildWorkflowParamsSummary(templateId, inputs);
    if (summary === text) continue;

    next[i] = { ...msg, content: summary };
    patchWorkflowExecution(sessionKey, runId, { paramsSummary: summary });
    changed = true;
  }

  return changed ? next : messages;
}
