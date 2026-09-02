import type { ChatDisplayItem } from './chat-display';

/** 低于此条数时直接全量渲染，避免短会话的虚拟化开销。 */
export const CHAT_VIRTUAL_LIST_THRESHOLD = 32;

/** 视口上下额外渲染的缓冲条数。 */
export const CHAT_VIRTUAL_OVERSCAN = 8;

export function estimateChatDisplayItemSize(item: ChatDisplayItem): number {
  switch (item.type) {
    case 'workflow-run':
      return 220;
    case 'assistant-turn':
      return Math.min(720, 160 + item.messages.length * 48 + item.toolResults.length * 32);
    case 'single':
      return 128;
    default:
      return 128;
  }
}
