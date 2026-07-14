/**
 * Local index of embed-browser chat conversations per app.
 * Gateway still owns message JSONL; this index tracks multi-session UI state.
 */
import {
  createSclawBrowserChatSessionKeyForApp,
  createSclawBrowserEmbedConversationId,
  isSclawBrowserEmbedChatSessionForApp,
} from '@/lib/sclaw-browser-chat-session';

export interface EmbedChatIndexItem {
  key: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface EmbedChatIndex {
  activeKey: string | null;
  items: EmbedChatIndexItem[];
}

const STORAGE_PREFIX = 'stoclaw:embed-chat-sessions:';

function storageKey(appId: string): string {
  return `${STORAGE_PREFIX}${appId}`;
}

function readRaw(appId: string): EmbedChatIndex {
  try {
    const raw = localStorage.getItem(storageKey(appId));
    if (!raw) return { activeKey: null, items: [] };
    const parsed = JSON.parse(raw) as EmbedChatIndex;
    if (!parsed || !Array.isArray(parsed.items)) return { activeKey: null, items: [] };
    return {
      activeKey: typeof parsed.activeKey === 'string' ? parsed.activeKey : null,
      items: parsed.items.filter((item) => item && typeof item.key === 'string'),
    };
  } catch {
    return { activeKey: null, items: [] };
  }
}

function writeRaw(appId: string, index: EmbedChatIndex): void {
  try {
    localStorage.setItem(storageKey(appId), JSON.stringify(index));
  } catch {
    // ignore quota / private mode
  }
}

function sortItems(items: EmbedChatIndexItem[]): EmbedChatIndexItem[] {
  return [...items].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Ensure at least one conversation exists; migrate legacy single-session key. */
export function ensureEmbedChatIndex(appId: string): EmbedChatIndex {
  const index = readRaw(appId);
  const legacyKey = createSclawBrowserChatSessionKeyForApp(appId);

  if (index.items.length === 0) {
    const now = Date.now();
    // Prefer legacy key first so existing history (pre multi-session) is preserved.
    const first: EmbedChatIndexItem = {
      key: legacyKey,
      title: '对话 1',
      createdAt: now,
      updatedAt: now,
    };
    const next = { activeKey: first.key, items: [first] };
    writeRaw(appId, next);
    return next;
  }

  const hasLegacy = index.items.some((item) => item.key === legacyKey);
  if (!hasLegacy) {
    // Keep other items; legacy key may still exist on disk from old version.
  }

  if (!index.activeKey || !index.items.some((item) => item.key === index.activeKey)) {
    const next = {
      ...index,
      activeKey: index.items[0]?.key ?? null,
      items: sortItems(index.items),
    };
    writeRaw(appId, next);
    return next;
  }

  return { ...index, items: sortItems(index.items) };
}

export function listEmbedChatIndex(appId: string): EmbedChatIndex {
  return ensureEmbedChatIndex(appId);
}

export function getActiveEmbedChatSessionKey(appId: string): string {
  const index = ensureEmbedChatIndex(appId);
  return index.activeKey || createSclawBrowserChatSessionKeyForApp(appId);
}

export function setActiveEmbedChatSessionKey(appId: string, sessionKey: string): EmbedChatIndex {
  const index = ensureEmbedChatIndex(appId);
  if (!isSclawBrowserEmbedChatSessionForApp(sessionKey, appId)) {
    return index;
  }
  const now = Date.now();
  let items = index.items.map((item) => (
    item.key === sessionKey ? { ...item, updatedAt: now } : item
  ));
  if (!items.some((item) => item.key === sessionKey)) {
    items = [
      {
        key: sessionKey,
        title: `对话 ${items.length + 1}`,
        createdAt: now,
        updatedAt: now,
      },
      ...items,
    ];
  }
  const next = { activeKey: sessionKey, items: sortItems(items) };
  writeRaw(appId, next);
  return next;
}

export function createEmbedChatIndexItem(
  appId: string,
  options?: { title?: string },
): { index: EmbedChatIndex; item: EmbedChatIndexItem } {
  const index = ensureEmbedChatIndex(appId);
  const now = Date.now();
  const conversationId = createSclawBrowserEmbedConversationId();
  const key = createSclawBrowserChatSessionKeyForApp(appId, conversationId);
  const item: EmbedChatIndexItem = {
    key,
    title: options?.title?.trim() || `对话 ${index.items.length + 1}`,
    createdAt: now,
    updatedAt: now,
  };
  const next = {
    activeKey: key,
    items: sortItems([item, ...index.items]),
  };
  writeRaw(appId, next);
  return { index: next, item };
}

export function touchEmbedChatIndexItem(
  appId: string,
  sessionKey: string,
  patch?: { title?: string },
): EmbedChatIndex {
  const index = ensureEmbedChatIndex(appId);
  const now = Date.now();
  const items = index.items.map((item) => {
    if (item.key !== sessionKey) return item;
    return {
      ...item,
      title: patch?.title?.trim() || item.title,
      updatedAt: now,
    };
  });
  const next = { ...index, items: sortItems(items) };
  writeRaw(appId, next);
  return next;
}

function createFreshEmbedChatItem(appId: string, title = '对话 1'): EmbedChatIndexItem {
  const now = Date.now();
  const conversationId = createSclawBrowserEmbedConversationId();
  return {
    key: createSclawBrowserChatSessionKeyForApp(appId, conversationId),
    title,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Remove a conversation from the local index.
 * If none remain, seed a brand-new empty conversation (fresh key, not legacy).
 */
export function removeEmbedChatIndexItem(
  appId: string,
  sessionKey: string,
): { index: EmbedChatIndex; nextActiveKey: string; replacedWithNew: boolean } {
  const index = ensureEmbedChatIndex(appId);
  const items = index.items.filter((item) => item.key !== sessionKey);

  if (items.length === 0) {
    const fresh = createFreshEmbedChatItem(appId);
    const next = { activeKey: fresh.key, items: [fresh] };
    writeRaw(appId, next);
    return { index: next, nextActiveKey: fresh.key, replacedWithNew: true };
  }

  const nextActiveKey = index.activeKey === sessionKey
    ? (items[0]?.key as string)
    : (index.activeKey && items.some((item) => item.key === index.activeKey)
      ? index.activeKey
      : items[0]!.key);
  const next = { activeKey: nextActiveKey, items: sortItems(items) };
  writeRaw(appId, next);
  return { index: next, nextActiveKey, replacedWithNew: false };
}
