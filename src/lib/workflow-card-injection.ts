/**
 * Attach workflow_card blocks to assistant messages (model execute_workflow path).
 */
import type { ContentBlock, RawMessage } from '@/stores/chat/types';
import { getExecutionByRunId, listSessionExecutions } from '@/stores/workflow-memory';
import { useChatStore } from '@/stores/chat';

export const RUN_ID_IN_TEXT = /\b(run_[\w-]+)\b/gi;

/** Extract visible assistant text from message content blocks (text parts only). */
export function getAssistantMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && typeof b === 'object' && (b as { type?: string }).type === 'text')
    .map((b) => String((b as { text?: string }).text ?? ''))
    .join('\n');
}

export function messageHasWorkflowCardForRun(message: RawMessage, runId: string): boolean {
  if (!Array.isArray(message.content)) return false;
  return (message.content as ContentBlock[]).some(
    (block) => block.type === 'workflow_card' && block.runId === runId,
  );
}

/** 助手「参数已确认」折叠块：文案含参数已确认且带 workflow_card。 */
export function isParamsConfirmedWorkflowAssistantMessage(
  message: RawMessage,
  getMessageText: (content: unknown) => string = getAssistantMessageText,
): boolean {
  if (message.role !== 'assistant') return false;
  if (!messageHasWorkflowCard(message)) return false;
  return /参数已确认/.test(getMessageText(message.content));
}

function messageHasWorkflowCard(message: RawMessage): boolean {
  if (!Array.isArray(message.content)) return false;
  return (message.content as ContentBlock[]).some((block) => block.type === 'workflow_card');
}

/** 会话内是否已有「参数已确认」消息承载该 run（可排除当前消息 id）。 */
export function sessionHasParamsConfirmedWorkflowForRun(
  messages: RawMessage[],
  runId: string,
  excludeMessageId?: string,
  getMessageText: (content: unknown) => string = getAssistantMessageText,
): boolean {
  return messages.some((message) => {
    if (excludeMessageId && message.id === excludeMessageId) return false;
    return isParamsConfirmedWorkflowAssistantMessage(message, getMessageText)
      && messageHasWorkflowCardForRun(message, runId);
  });
}

export function stripWorkflowCardBlocksForRun(message: RawMessage, runId: string): RawMessage {
  if (!Array.isArray(message.content)) return message;
  const blocks = message.content as ContentBlock[];
  const filtered = blocks.filter(
    (block) => !(block.type === 'workflow_card' && block.runId === runId),
  );
  if (filtered.length === blocks.length) return message;
  return {
    ...message,
    content: filtered.length > 0 ? filtered : [{ type: 'text', text: '' }],
  };
}

/** 参数已确认消息为唯一载体时，从其它助手消息移除同 runId 的 workflow_card。 */
export function dedupeWorkflowCardsForParamsConfirmedTurn(
  messages: RawMessage[],
  runId: string,
  getMessageText: (content: unknown) => string = getAssistantMessageText,
): RawMessage[] {
  const owner = messages.find(
    (message) =>
      isParamsConfirmedWorkflowAssistantMessage(message, getMessageText)
      && messageHasWorkflowCardForRun(message, runId),
  );
  if (!owner) return messages;

  let changed = false;
  const next = messages.map((message) => {
    if (message === owner) return message;
    if (!messageHasWorkflowCardForRun(message, runId)) return message;
    changed = true;
    return stripWorkflowCardBlocksForRun(message, runId);
  });
  return changed ? next : messages;
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

  // Tool-only assistant snapshots (execute_workflow) may have no text yet — still attach here.
  if (targetIdx < 0) {
    for (let i = messages.length - 1; i > lastUserIdx; i--) {
      if (messages[i].role === 'assistant') {
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

/** Preserve frontend-only workflow_card blocks when Gateway history overwrites messages. */
export function mergeWorkflowCardBlocksFromCurrent(
  loaded: RawMessage[],
  current: RawMessage[],
): RawMessage[] {
  if (current.length === 0) return loaded;

  return loaded.map((loadedMsg) => {
    if (loadedMsg.role !== 'assistant' || !Array.isArray(loadedMsg.content)) return loadedMsg;

    const match = loadedMsg.id ? current.find((m) => m.id === loadedMsg.id) : undefined;
    if (!match || !Array.isArray(match.content)) return loadedMsg;

    const cardBlocks = (match.content as ContentBlock[]).filter(
      (b) => b.type === 'workflow_card' && b.runId,
    );
    if (cardBlocks.length === 0) return loadedMsg;

    let merged = loadedMsg;
    for (const block of cardBlocks) {
      merged = appendWorkflowCardBlockToMessage(
        merged,
        block.runId!,
        block.templateName ?? '工作流',
      );
    }
    return merged;
  });
}

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

  const lastUserIdx = findLastUserIndex(next);

  for (const exec of executions) {
    if (next.some((m) => messageHasWorkflowCardForRun(m, exec.runId))) continue;

    let patched = false;
    for (let i = next.length - 1; i >= 0; i--) {
      const msg = next[i];
      if (msg.role !== 'assistant') continue;
      const text = getMessageText(msg.content);
      const inCurrentTurn = i > lastUserIdx;
      const matchesRunId = inCurrentTurn && text.includes(exec.runId);
      // workflowId appears in many historical turns — only match the current user turn.
      const matchesWorkflowId = inCurrentTurn && text.includes(exec.workflowId);
      if (matchesRunId || matchesWorkflowId) {
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

  // Assistant may mention a run ID before execution memory is visible — use live card state.
  for (let i = next.length - 1; i > lastUserIdx; i -= 1) {
    const msg = next[i];
    if (msg.role !== 'assistant') continue;
    const text = getMessageText(msg.content);
    const mentionedRunIds = [...text.matchAll(RUN_ID_IN_TEXT)]
      .map((match) => match[1])
      .filter(Boolean);
    if (mentionedRunIds.length === 0) continue;

    let patchedMsg = msg;
    for (const runId of mentionedRunIds) {
      if (next.some((m) => messageHasWorkflowCardForRun(m, runId))) continue;
      const exec = getExecutionByRunId(runId, sessionKey);
      patchedMsg = appendWorkflowCardBlockToMessage(
        patchedMsg,
        runId,
        exec?.templateName ?? '工作流',
      );
    }
    if (patchedMsg !== msg) {
      const updated = [...next];
      updated[i] = patchedMsg;
      next = updated;
    }
    break;
  }

  return next;
}
