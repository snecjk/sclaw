import type { A2uiMessage } from './action-executor';
import homePage from '../pages/home.page.json';
import customerListPage from '../pages/customer-list.page.json';

export type PageId = 'home' | 'customer-list';

const PAGE_REGISTRY: Record<PageId, A2uiMessage[]> = {
  home: homePage as A2uiMessage[],
  'customer-list': customerListPage as A2uiMessage[],
};

export function listPageIds(): PageId[] {
  return Object.keys(PAGE_REGISTRY) as PageId[];
}

export function isPageId(value: string): value is PageId {
  return value in PAGE_REGISTRY;
}

export function loadPageMessages(pageId: PageId): A2uiMessage[] {
  const messages = PAGE_REGISTRY[pageId];
  if (!messages?.length) {
    throw new Error(`页面为空: src/pages/${pageId}.page.json`);
  }
  for (const [index, message] of messages.entries()) {
    if (!message || typeof message !== 'object') {
      throw new Error(`无效 A2UI 消息: ${pageId}[#${index}]`);
    }
    if (message.version !== 'v0.9') {
      throw new Error(`仅支持 A2UI v0.9: ${pageId}[#${index}] version=${String(message.version)}`);
    }
  }
  return messages;
}

/** Hash route: #home / #customer-list */
export function pageIdFromLocation(fallback: PageId = 'home'): PageId {
  const hash = window.location.hash.replace(/^#/, '').trim();
  if (hash && isPageId(hash)) return hash;
  return fallback;
}

export function setPageHash(pageId: PageId): void {
  if (window.location.hash.replace(/^#/, '') === pageId) return;
  window.location.hash = pageId;
}
