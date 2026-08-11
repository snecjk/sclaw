import type { RawMessage } from '@/stores/chat';
import { hasVisibleUserMessageContent } from '@/stores/chat/user-message-merge';
import { RUN_ID_IN_TEXT } from '@/lib/workflow-card-injection';
import { isTerminalWorkflowRunStatus } from '@/lib/workflow-run-status';
import { getExecutionByRunId } from '@/stores/workflow-memory';
import type { WorkflowRunStatus } from '@/types/workflow';
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

function turnHasWorkflowCardForRun(messages: RawMessage[], lastUserIdx: number, runId: string): boolean {
  for (let i = lastUserIdx + 1; i < messages.length; i += 1) {
    const msg = messages[i];
    if (msg.role === 'user') break;
    if (msg.role !== 'assistant') continue;
    const card = extractWorkflowCard(msg);
    if (card?.runId === runId) return true;
  }
  return false;
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

function resolveWorkflowRunStatusForTurn(
  runId: string,
  workflowCardStates: Record<string, { status?: string } | undefined>,
  sessionKey?: string,
): WorkflowRunStatus | undefined {
  const fromStore = workflowCardStates[runId]?.status;
  if (fromStore != null) return fromStore as WorkflowRunStatus;
  if (!sessionKey) return undefined;
  return getExecutionByRunId(runId, sessionKey)?.status;
}

/** 该助手行是否带有用户可见的正文/工作流卡（会单独成泡或作为合并回复主体）。 */
export function assistantMessageHasVisibleReplyBody(message: RawMessage): boolean {
  if (extractText(message).trim().length > 0) return true;
  if (extractWorkflowCard(message)) return true;
  return false;
}

/**
 * 同轮内用于挂载 meta 的「展示回复」消息。
 * 与 AssistantTurnMessage / pickAssistantReplyMessage 口径对齐：取最后一条带正文的助手行；
 * 若仅有 workflow_card 等无正文行，则回退到该轮最后一条助手。
 */
export function findTurnDisplayAssistantMessage(
  messages: RawMessage[],
  turnUserIdx: number,
): RawMessage | null {
  let lastTextReply: RawMessage | null = null;
  let lastVisible: RawMessage | null = null;
  for (let i = turnUserIdx + 1; i < messages.length; i += 1) {
    const msg = messages[i];
    if (msg.role === 'user') break;
    if (msg.role !== 'assistant') continue;
    if (assistantMessageHasVisibleReplyBody(msg)) {
      lastVisible = msg;
      if (extractText(msg).trim().length > 0) {
        lastTextReply = msg;
      }
    }
  }
  // 与 pickAssistantReplyMessage + workflow_card 注入一致：优先挂载在有正文的行上
  if (lastTextReply) return lastTextReply;
  if (lastVisible) return lastVisible;

  for (let i = messages.length - 1; i > turnUserIdx; i -= 1) {
    if (messages[i].role === 'assistant') return messages[i];
  }
  return null;
}

/**
 * 当前用户轮次是否仍未结束（流式 / 填表 / 工作流非终态等）。
 * 用于隐藏用户/助手消息的时间戳与复制，直到整轮对话真正结束。
 */
export function isCurrentUserTurnIncomplete(options: {
  sessionMessages: RawMessage[];
  sending: boolean;
  lastUserMessageAt: number | null;
  /** Gateway 仍在整理工具结果 / 等待下一段输出 */
  pendingFinal?: boolean;
  /** 仍有活跃 run，整轮未 terminal */
  activeRunId?: string | null;
  workflowCardStates: Record<string, { status?: string } | undefined>;
  hasPendingWorkflowSchema: boolean;
  sessionKey?: string;
}): boolean {
  const {
    sessionMessages,
    sending,
    lastUserMessageAt,
    pendingFinal = false,
    activeRunId = null,
    workflowCardStates,
    hasPendingWorkflowSchema,
    sessionKey,
  } = options;

  if (sending || lastUserMessageAt != null || pendingFinal || activeRunId != null) return true;

  const lastUserIdx = findLastUserMessageIndex(sessionMessages);
  if (lastUserIdx < 0) return false;

  if (hasPendingWorkflowSchema) return true;
  if (lastAssistantHasOpenParameterForm(sessionMessages, lastUserIdx)) return true;

  for (const runId of collectRunIdsAfterUser(sessionMessages, lastUserIdx)) {
    const status = resolveWorkflowRunStatusForTurn(runId, workflowCardStates, sessionKey);
    if (status != null && !isTerminalWorkflowRunStatus(status)) {
      return true;
    }
    // 仅正文提及 runId、无 workflow_card / 无状态记录时，不阻塞技能/普通对话 meta
    if (status == null && turnHasWorkflowCardForRun(sessionMessages, lastUserIdx, runId)) {
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
    if (isCountableUserTurn(messages[i])) return i;
  }
  return -1;
}

/** 消息所属轮次 index（0-based，按可见 user 消息计数，与 Claude allocateTurnIndex 对齐）。 */
export function getTurnIndexForAssistantMessage(
  message: RawMessage,
  messages: RawMessage[],
): number {
  const turnUserIdx = findTurnUserIndexForMessage(message, messages);
  if (turnUserIdx < 0) return -1;
  let turnIndex = 0;
  for (let i = 0; i < turnUserIdx; i += 1) {
    if (!isCountableUserTurn(messages[i])) continue;
    turnIndex += 1;
  }
  return turnIndex;
}

function isCountableUserTurn(message: RawMessage): boolean {
  if (message.role !== 'user') return false;
  if (message.id?.startsWith('session-label-user-')) return false;
  return hasVisibleUserMessageContent(message);
}

/** 是否为该轮 UI 合并展示的最终助手回复（meta 挂载点）。 */
export function isTurnDisplayAssistantMessage(
  message: RawMessage,
  messages: RawMessage[],
): boolean {
  if (message.role !== 'assistant') return false;
  const turnUserIdx = findTurnUserIndexForMessage(message, messages);
  if (turnUserIdx < 0) return false;
  const display = findTurnDisplayAssistantMessage(messages, turnUserIdx);
  if (!display) return false;
  if (message.id != null && display.id != null) return message.id === display.id;
  return message === display;
}

/**
 * 是否为该用户轮次内的最后一条助手消息（每轮各一条，不限于会话最后一轮）。
 * @deprecated 展示层请优先使用 isTurnDisplayAssistantMessage
 */
export function isLastAssistantInUserTurn(
  message: RawMessage,
  messages: RawMessage[],
): boolean {
  return isTurnDisplayAssistantMessage(message, messages);
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
