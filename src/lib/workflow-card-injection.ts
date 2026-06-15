/**
 * Attach workflow_card blocks to assistant messages (model execute_workflow path).
 */
import type { ContentBlock, RawMessage } from '@/stores/chat/types';
import { listSessionExecutions } from '@/stores/workflow-memory';

const RUN_ID_IN_TEXT = /\b(run_[\w-]+)\b/i;

export function messageHasWorkflowCardForRun(message: RawMessage, runId: string): boolean {
  if (!Array.isArray(message.content)) return false;
  return (message.content as ContentBlock[]).some(
    (block) => block.type === 'workflow_card' && block.runId === runId,
  );
}

export function appendWorkflowCardBlockToMessage(
  message: RawMessage,
  runId: string,
  templateName: string,
): RawMessage {
  if (messageHasWorkflowCardForRun(message, runId)) return message;

  const cardBlock: ContentBlock = {
    type: 'workflow_card',
    runId,
    templateName,
  };

  if (Array.isArray(message.content)) {
    return {
      ...message,
      content: [...(message.content as ContentBlock[]), cardBlock],
    };
  }

  if (typeof message.content === 'string' && message.content.trim()) {
    return {
      ...message,
      content: [{ type: 'text', text: message.content }, cardBlock],
    };
  }

  return { ...message, content: [cardBlock] };
}

function findLastUserIndex(messages: RawMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return i;
  }
  return -1;
}

/** Prefer the assistant turn that mentions runId; otherwise the latest assistant after the last user. */
export function patchLastAssistantWithWorkflowCard(
  messages: RawMessage[],
  runId: string,
  templateName: string,
  getMessageText: (content: unknown) => string,
): RawMessage[] {
  if (messages.some((m) => messageHasWorkflowCardForRun(m, runId))) return messages;

  const lastUserIdx = findLastUserIndex(messages);
  let targetIdx = -1;

  for (let i = messages.length - 1; i > lastUserIdx; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant') continue;
    const text = getMessageText(msg.content);
    if (text.includes(runId)) {
      targetIdx = i;
      break;
    }
  }

  if (targetIdx < 0) {
    for (let i = messages.length - 1; i > lastUserIdx; i--) {
      if (messages[i].role === 'assistant' && getMessageText(messages[i].content).trim()) {
        targetIdx = i;
        break;
      }
    }
  }

  if (targetIdx < 0) return messages;

  const next = [...messages];
  next[targetIdx] = appendWorkflowCardBlockToMessage(next[targetIdx], runId, templateName);
  return next;
}

function assistantTextMatchesExecution(
  text: string,
  exec: { runId: string; workflowId: string },
): boolean {
  return text.includes(exec.runId) || text.includes(exec.workflowId);
}

/** Scan assistant text for run IDs and attach cards using session execution metadata. */
export function ensureWorkflowCardsInMessages(
  messages: RawMessage[],
  sessionKey: string,
  getMessageText: (content: unknown) => string,
): RawMessage[] {
  let next = messages;
  const executions = listSessionExecutions(sessionKey);
  const latestMissingCard = executions.find(
    (exec) => !next.some((m) => messageHasWorkflowCardForRun(m, exec.runId)),
  );

  for (const exec of executions) {
    if (next.some((m) => messageHasWorkflowCardForRun(m, exec.runId))) continue;

    let patched = false;
    for (let i = next.length - 1; i >= 0; i--) {
      const msg = next[i];
      if (msg.role !== 'assistant') continue;
      const text = getMessageText(msg.content);
      const runMatch = text.match(RUN_ID_IN_TEXT);
      if (runMatch?.[1] === exec.runId || assistantTextMatchesExecution(text, exec)) {
        const updated = [...next];
        updated[i] = appendWorkflowCardBlockToMessage(msg, exec.runId, exec.templateName);
        next = updated;
        patched = true;
        break;
      }
    }
    if (patched) continue;

    // Only auto-attach the newest execution still missing a card — avoid stale runs on new bubbles.
    if (latestMissingCard?.runId !== exec.runId) continue;

    const fallback = patchLastAssistantWithWorkflowCard(
      next,
      exec.runId,
      exec.templateName,
      getMessageText,
    );
    if (fallback !== next) next = fallback;
  }

  return next;
}
