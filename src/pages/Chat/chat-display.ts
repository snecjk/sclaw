import type { RawMessage } from '@/stores/chat';
import {
  extractText,
  extractThinkingTimeline,
  isHiddenWorkflowCompleteUserMessage,
  isHiddenDuplicateWorkflowPreambleAssistantMessage,
  isHiddenWorkflowParamsUserMessage,
  isWorkflowPreambleAssistantMessage,
  messageHasWorkflowCard,
  type ThinkingTimelineItem,
} from './message-utils';

export type ChatDisplayItem =
  | { type: 'single'; message: RawMessage; key: string }
  | {
      type: 'assistant-turn';
      messages: RawMessage[];
      toolResults: RawMessage[];
      precedingUserMessage?: RawMessage;
      key: string;
    };

function normalizeRole(role: unknown): string {
  return typeof role === 'string' ? role.toLowerCase() : '';
}

export function isAssistantRole(role: unknown): boolean {
  const r = normalizeRole(role);
  return r === 'assistant' || r === '';
}

export function isThinkingOnlyAssistantMessage(message: RawMessage): boolean {
  if (!isAssistantRole(message.role)) return false;
  if (extractText(message).trim().length > 0) return false;
  return extractThinkingTimeline(message).length > 0;
}

function normalizeThinkingKey(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase();
}

/** Collapse streaming re-phrases and near-duplicate planning lines in thinking blocks. */
export function isRedundantThinking(prev: string, next: string): boolean {
  if (prev === next) return true;
  const a = normalizeThinkingKey(prev);
  const b = normalizeThinkingKey(next);
  if (!a || !b) return false;
  if (a === b) return true;

  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length >= 20 && longer.includes(shorter)) return true;

  // Shared substantial substring (same planning sentence with edits).
  const minShared = Math.min(18, shorter.length);
  for (let start = 0; start <= shorter.length - minShared; start += 1) {
    const slice = shorter.slice(start, start + minShared);
    if (longer.includes(slice)) {
      const lengthDelta = Math.abs(a.length - b.length);
      if (lengthDelta <= Math.max(36, shorter.length * 0.55)) return true;
      break;
    }
  }

  // Same opening intent with minor rewording (common in qwen thinking streams).
  const intentPrefixLen = Math.min(12, shorter.length, longer.length);
  if (intentPrefixLen >= 10 && shorter.slice(0, intentPrefixLen) === longer.slice(0, intentPrefixLen)) {
    const lengthDelta = Math.abs(a.length - b.length);
    if (lengthDelta <= Math.max(36, shorter.length * 0.55)) return true;
  }

  return false;
}

function preferThinkingContent(a: string, b: string): string {
  return b.length >= a.length ? b : a;
}

function messageToolIds(message: RawMessage): string[] {
  return extractThinkingTimeline(message)
    .filter((item): item is Extract<ThinkingTimelineItem, { type: 'tool' }> => item.type === 'tool')
    .map((item) => item.id)
    .filter(Boolean);
}

/**
 * Streaming turns append many assistant snapshots that only rephrase thinking.
 * Keep snapshots that introduce new tools or final reply text; otherwise fold
 * consecutive thinking-only snapshots to the latest one.
 */
function pickTimelineSourceMessages(messages: RawMessage[]): RawMessage[] {
  if (messages.length <= 1) return messages;

  const picked: RawMessage[] = [];
  const seenToolIds = new Set<string>();

  for (const message of messages) {
    const toolIds = messageToolIds(message);
    const hasNewTool = toolIds.some((id) => !seenToolIds.has(id));
    for (const id of toolIds) seenToolIds.add(id);

    const hasReplyText = extractText(message).trim().length > 0;
    if (picked.length === 0 || hasNewTool || hasReplyText) {
      picked.push(message);
      continue;
    }

    if (isThinkingOnlyAssistantMessage(message)) {
      const last = picked[picked.length - 1];
      if (last && isThinkingOnlyAssistantMessage(last)) {
        picked[picked.length - 1] = message;
      } else {
        picked.push(message);
      }
      continue;
    }

    picked.push(message);
  }

  return picked;
}

/** Merge timelines from multiple assistant snapshots; renumber tools sequentially. */
export function mergeThinkingTimelines(messages: RawMessage[]): ThinkingTimelineItem[] {
  const merged: ThinkingTimelineItem[] = [];
  let toolIndex = 0;

  for (const message of pickTimelineSourceMessages(messages)) {
    for (const item of extractThinkingTimeline(message)) {
      if (item.type === 'tool') {
        toolIndex += 1;
        merged.push({
          ...item,
          index: toolIndex,
          id: item.id || `tool-${toolIndex}`,
        });
      } else {
        const prev = merged[merged.length - 1];
        if (prev?.type === 'thinking' && isRedundantThinking(prev.content, item.content)) {
          merged[merged.length - 1] = {
            type: 'thinking',
            content: preferThinkingContent(prev.content, item.content),
          };
          continue;
        }
        merged.push(item);
      }
    }
  }

  return merged;
}

export function findLastUserMessage(messages: RawMessage[]): RawMessage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (normalizeRole(messages[i].role) === 'user') return messages[i];
  }
  return null;
}

export function buildChatDisplayItems(messages: RawMessage[]): ChatDisplayItem[] {
  const items: ChatDisplayItem[] = [];
  let lastUserMessage: RawMessage | null = null;
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];
    const role = normalizeRole(msg.role);

    if (role === 'toolresult' || role === 'tool_result') {
      i += 1;
      continue;
    }

    if (role === 'user') {
      if (isHiddenWorkflowCompleteUserMessage(msg)) {
        i += 1;
        continue;
      }
      if (isHiddenWorkflowParamsUserMessage(msg, messages, i)) {
        i += 1;
        continue;
      }
      lastUserMessage = msg;
      items.push({ type: 'single', message: msg, key: msg.id || `user-${i}` });
      i += 1;
      continue;
    }

    if (isAssistantRole(msg.role)) {
      if (isHiddenDuplicateWorkflowPreambleAssistantMessage(msg, messages, i)) {
        i += 1;
        continue;
      }

      const start = i;
      const turnMessages: RawMessage[] = [];
      const turnToolResults: RawMessage[] = [];
      while (i < messages.length) {
        const current = messages[i];
        const currentRole = normalizeRole(current.role);
        if (currentRole === 'user') break;
        if (currentRole === 'toolresult' || currentRole === 'tool_result') {
          turnToolResults.push(current);
          i += 1;
          continue;
        }
        if (!isAssistantRole(current.role)) break;
        if (isHiddenDuplicateWorkflowPreambleAssistantMessage(current, messages, i)) {
          i += 1;
          continue;
        }
        // 方案 A：分组参数 intro 与 workflow_card 执行卡不能合并成同一 assistant-turn
        if (
          turnMessages.length > 0
          && messageHasWorkflowCard(current)
          && turnMessages.some(isWorkflowPreambleAssistantMessage)
        ) {
          break;
        }
        turnMessages.push(current);
        i += 1;
      }

      if (turnMessages.length === 0) continue;

      const hasMultiple = turnMessages.length > 1;
      const onlyThinkingSnapshots = turnMessages.every(isThinkingOnlyAssistantMessage);

      if (hasMultiple || onlyThinkingSnapshots) {
        items.push({
          type: 'assistant-turn',
          messages: turnMessages,
          toolResults: turnToolResults,
          precedingUserMessage: lastUserMessage ?? undefined,
          key: `turn-${start}-${turnMessages[turnMessages.length - 1]?.id ?? i}`,
        });
      } else {
        items.push({
          type: 'single',
          message: turnMessages[0],
          key: turnMessages[0].id || `assistant-${start}`,
        });
      }
      continue;
    }

    items.push({ type: 'single', message: msg, key: msg.id || `msg-${i}` });
    i += 1;
  }

  return items;
}

/** Pick the message that carries the user-visible assistant reply (last with text). */
export function pickAssistantReplyMessage(messages: RawMessage[]): RawMessage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (extractText(messages[i]).trim().length > 0) return messages[i];
  }
  return messages[messages.length - 1] ?? null;
}
