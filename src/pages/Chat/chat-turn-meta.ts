import type { RawMessage } from '@/stores/chat';
import { RUN_ID_IN_TEXT } from '@/lib/workflow-card-injection';
import { isTerminalWorkflowRunStatus } from '@/lib/workflow-run-status';
import { extractText, extractWorkflowCard } from '@/pages/Chat/message-utils';

export function findLastUserMessageIndex(messages: RawMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') return i;
  }
  return -1;
}

/** 是否为会话中最后一条用户消息 */
export function isLastUserMessage(message: RawMessage, messages: RawMessage[]): boolean {
  const lastIdx = findLastUserMessageIndex(messages);
  if (lastIdx < 0) return false;
  const last = messages[lastIdx];
  if (message.id != null && last.id != null) return message.id === last.id;
  return messages.indexOf(message) === lastIdx;
}

function collectRunIdsAfterUser(messages: RawMessage[], lastUserIdx: number): string[] {
  const runIds = new Set<string>();
  for (let i = lastUserIdx + 1; i < messages.length; i += 1) {
    const msg = messages[i];
    if (msg.role !== 'assistant') continue;
    const card = extractWorkflowCard(msg);
    if (card?.runId) runIds.add(card.runId);
    const text = extractText(msg);
    for (const match of text.matchAll(RUN_ID_IN_TEXT)) {
      if (match[1]) runIds.add(match[1]);
    }
  }
  return [...runIds];
}

function lastAssistantHasOpenParameterForm(messages: RawMessage[], lastUserIdx: number): boolean {
  for (let i = messages.length - 1; i > lastUserIdx; i -= 1) {
    const msg = messages[i];
    if (msg.role !== 'assistant') continue;
    const blocks = Array.isArray(msg.content) ? msg.content : [];
    return blocks.some(
      (block) =>
        typeof block === 'object'
        && block !== null
        && (block as { type?: string }).type === 'parameter_form',
    );
  }
  return false;
}

/**
 * 当前用户轮次是否仍未结束（流式 / 填表 / 工作流非终态等）。
 * 用于隐藏用户/助手消息的时间戳与复制，直到整轮对话真正结束。
 */
export function isCurrentUserTurnIncomplete(options: {
  sessionMessages: RawMessage[];
  sending: boolean;
  lastUserMessageAt: number | null;
  workflowCardStates: Record<string, { status?: string } | undefined>;
  hasPendingWorkflowSchema: boolean;
}): boolean {
  const {
    sessionMessages,
    sending,
    lastUserMessageAt,
    workflowCardStates,
    hasPendingWorkflowSchema,
  } = options;

  if (sending || lastUserMessageAt != null) return true;

  const lastUserIdx = findLastUserMessageIndex(sessionMessages);
  if (lastUserIdx < 0) return false;

  if (hasPendingWorkflowSchema) return true;
  if (lastAssistantHasOpenParameterForm(sessionMessages, lastUserIdx)) return true;

  for (const runId of collectRunIdsAfterUser(sessionMessages, lastUserIdx)) {
    const state = workflowCardStates[runId];
    if (state?.status == null || !isTerminalWorkflowRunStatus(state.status)) {
      return true;
    }
  }

  return false;
}

function messageIndex(message: RawMessage, messages: RawMessage[]): number {
  if (message.id != null) {
    const byId = messages.findIndex((m) => m.id === message.id);
    if (byId >= 0) return byId;
  }
  return messages.indexOf(message);
}

/** 消息所属的用户轮次起点（上一条 user 的下标） */
export function findTurnUserIndexForMessage(
  message: RawMessage,
  messages: RawMessage[],
): number {
  const msgIdx = messageIndex(message, messages);
  if (msgIdx < 0) return -1;
  for (let i = msgIdx - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') return i;
  }
  return -1;
}

/** 是否为该用户轮次内的最后一条助手消息（每轮各一条，不限于会话最后一轮） */
export function isLastAssistantInUserTurn(
  message: RawMessage,
  messages: RawMessage[],
): boolean {
  if (message.role !== 'assistant') return false;
  const msgIdx = messageIndex(message, messages);
  if (msgIdx < 0) return false;

  for (let i = msgIdx + 1; i < messages.length; i += 1) {
    const role = messages[i].role;
    if (role === 'user') return true;
    if (role === 'assistant') return false;
  }
  return true;
}

/** 消息是否属于会话中最后一轮（最后一条 user 之后） */
export function isMessageInCurrentUserTurn(
  message: RawMessage,
  messages: RawMessage[],
): boolean {
  const turnUserIdx = findTurnUserIndexForMessage(message, messages);
  if (turnUserIdx < 0) return false;
  return turnUserIdx === findLastUserMessageIndex(messages);
}
