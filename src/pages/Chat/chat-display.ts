import type { RawMessage } from '@/stores/chat';
import { extractText, extractThinkingTimeline, type ThinkingTimelineItem } from './message-utils';

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

/** Merge timelines from multiple assistant snapshots; renumber tools sequentially. */
export function mergeThinkingTimelines(messages: RawMessage[]): ThinkingTimelineItem[] {
  const merged: ThinkingTimelineItem[] = [];
  let toolIndex = 0;

  for (const message of messages) {
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
        if (prev?.type === 'thinking' && prev.content === item.content) continue;
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
      lastUserMessage = msg;
      items.push({ type: 'single', message: msg, key: msg.id || `user-${i}` });
      i += 1;
      continue;
    }

    if (isAssistantRole(msg.role)) {
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
