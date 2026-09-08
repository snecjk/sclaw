import type { A2uiMessage } from './types';
import homePage from '../pages/home.page.json';
import customerListPage from '../pages/customer-list.page.json';

export type PageId = 'home' | 'customer-list';

const PAGE_MESSAGES: Record<PageId, A2uiMessage[]> = {
  home: homePage as A2uiMessage[],
  'customer-list': customerListPage as A2uiMessage[],
};

export const DEFAULT_PAGE_ID: PageId = 'home';

export function listPageIds(): PageId[] {
  return Object.keys(PAGE_MESSAGES) as PageId[];
}

export function isPageId(value: string): value is PageId {
  return value in PAGE_MESSAGES;
}

/** Resolve initial page from ?page= or #page= */
export function resolveInitialPageId(): PageId {
  if (typeof window === 'undefined') return DEFAULT_PAGE_ID;
  const fromQuery = new URLSearchParams(window.location.search).get('page');
  if (fromQuery && isPageId(fromQuery)) return fromQuery;
  const hash = window.location.hash.replace(/^#/, '');
  if (hash.startsWith('page=')) {
    const id = hash.slice('page='.length);
    if (isPageId(id)) return id;
  }
  if (hash && isPageId(hash)) return hash;
  return DEFAULT_PAGE_ID;
}

export function loadPageMessages(pageId: PageId): A2uiMessage[] {
  const messages = PAGE_MESSAGES[pageId];
  if (!messages?.length) {
    throw new Error(`页面资产为空或不存在: src/pages/${pageId}.page.json`);
  }
  validatePageMessages(pageId, messages);
  return messages;
}

export function validatePageMessages(pageId: string, messages: A2uiMessage[]): void {
  if (!Array.isArray(messages)) {
    throw new Error(`${pageId}: 页面资产必须是 A2UI 消息数组`);
  }
  const hasCreate = messages.some((m) => m && typeof m === 'object' && 'createSurface' in m);
  if (!hasCreate) {
    throw new Error(`${pageId}: 缺少 createSurface 消息`);
  }
  for (const message of messages) {
    if (!message || typeof message !== 'object') {
      throw new Error(`${pageId}: 存在非法消息项`);
    }
    if (message.version !== 'v0.9') {
      throw new Error(`${pageId}: 仅支持 version: "v0.9"`);
    }
  }
}
