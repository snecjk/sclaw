/**
 * 聊天消息搜索：稳定 searchKey + DOM 采集/定位。
 * 不依赖可选的 RawMessage.id，避免无 id 历史消息无法进入搜索索引。
 */

export interface SearchableChatMessage {
  key: string;
  text: string;
}

/** 有后端 id → message:${id}；否则使用渲染层稳定 fallbackKey（禁止随机）。 */
export function resolveChatMessageSearchKey(
  messageId: string | undefined,
  fallbackKey: string,
): string {
  const trimmed = messageId?.trim();
  if (trimmed) return `message:${trimmed}`;
  return fallbackKey;
}

export function collectSearchableChatMessages(root: HTMLElement): SearchableChatMessage[] {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>('[data-chat-search-key]'));
  const seen = new Set<string>();
  const result: SearchableChatMessage[] = [];

  for (const node of nodes) {
    const key = node.dataset.chatSearchKey?.trim() ?? '';
    if (!key || seen.has(key)) continue;
    const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    seen.add(key);
    result.push({ key, text });
  }

  return result;
}

export function findChatMessageSearchTarget(
  root: HTMLElement,
  searchKey: string,
): HTMLElement | null {
  const targetKey = searchKey.trim();
  if (!targetKey) return null;
  const nodes = Array.from(root.querySelectorAll<HTMLElement>('[data-chat-search-key]'));
  return nodes.find((node) => (node.dataset.chatSearchKey?.trim() ?? '') === targetKey) ?? null;
}
