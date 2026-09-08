import type { ChatDisplayItem } from '@/pages/Chat/chat-display';
import { isAssistantRole, pickAssistantReplyMessage } from '@/pages/Chat/chat-display';
import { extractText } from '@/pages/Chat/message-utils';
import type { RawMessage } from '@/stores/chat';

export interface ChatTurnNavigationEntry {
  key: string;
  targetItemKey: string;
  prompt: string;
  reply: string;
  /** Position on the transcript rail, normalized to 0…1. */
  position: number;
}

export function toChatNavigationExcerpt(value: string, limit = 96): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
}

function sameMessage(left: { id?: string }, right: { id?: string }): boolean {
  return Boolean(left.id && right.id && left.id === right.id) || left === right;
}

/**
 * Produces one navigator stop per visible user turn. Assistant turns attach
 * their final reply to the user item which already owns the scroll target.
 */
export function buildChatTurnNavigationEntries(items: ChatDisplayItem[]): ChatTurnNavigationEntry[] {
  const entries: Array<ChatTurnNavigationEntry & { source: RawMessage }> = [];

  items.forEach((item, index) => {
    if (item.type === 'single' && item.message.role === 'user') {
      const prompt = toChatNavigationExcerpt(extractText(item.message));
      if (!prompt) return;
      entries.push({
        key: item.message.id || item.key,
        targetItemKey: item.key,
        prompt,
        reply: '',
        position: items.length > 1 ? index / (items.length - 1) : 0,
        source: item.message,
      });
      return;
    }

    if (item.type !== 'assistant-turn') return;
    const precedingUserMessage = item.precedingUserMessage;
    if (!precedingUserMessage) return;
    const entry = [...entries].reverse().find((candidate) => (
      sameMessage(candidate.source, precedingUserMessage)
    ));
    const reply = pickAssistantReplyMessage(item.messages);
    if (entry && reply && isAssistantRole(reply.role)) {
      entry.reply = toChatNavigationExcerpt(extractText(reply));
    }
  });

  return entries.map(({ source: _source, ...entry }) => entry);
}
