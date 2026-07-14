import { beforeEach, describe, expect, it } from 'vitest';
import {
  createEmbedChatIndexItem,
  ensureEmbedChatIndex,
  getActiveEmbedChatSessionKey,
  listEmbedChatIndex,
  removeEmbedChatIndexItem,
  setActiveEmbedChatSessionKey,
} from '@/lib/sclaw-browser-chat-index';
import { createSclawBrowserChatSessionKeyForApp } from '@/lib/sclaw-browser-chat-session';

describe('sclaw-browser-chat-index', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('bootstraps legacy single-session key as first conversation', () => {
    const index = ensureEmbedChatIndex('org-relation');
    const legacy = createSclawBrowserChatSessionKeyForApp('org-relation');
    expect(index.items).toHaveLength(1);
    expect(index.items[0]?.key).toBe(legacy);
    expect(index.activeKey).toBe(legacy);
    expect(getActiveEmbedChatSessionKey('org-relation')).toBe(legacy);
  });

  it('creates additional conversations under the same app', () => {
    ensureEmbedChatIndex('org-relation');
    const { item, index } = createEmbedChatIndexItem('org-relation');
    expect(index.items.length).toBe(2);
    expect(item.key).toContain('org-relation--');
    expect(index.activeKey).toBe(item.key);
  });

  it('switches active conversation', () => {
    const first = getActiveEmbedChatSessionKey('org-relation');
    const { item: second } = createEmbedChatIndexItem('org-relation');
    setActiveEmbedChatSessionKey('org-relation', first);
    const listed = listEmbedChatIndex('org-relation');
    expect(listed.activeKey).toBe(first);
    expect(listed.items.some((entry) => entry.key === second.key)).toBe(true);
  });

  it('removes a conversation and activates another', () => {
    const first = getActiveEmbedChatSessionKey('org-relation');
    const { item: second } = createEmbedChatIndexItem('org-relation');
    const result = removeEmbedChatIndexItem('org-relation', second.key);
    expect(result.replacedWithNew).toBe(false);
    expect(result.nextActiveKey).toBe(first);
    expect(result.index.items.map((item) => item.key)).toEqual([first]);
  });

  it('creates a fresh empty conversation when the last one is deleted', () => {
    const first = getActiveEmbedChatSessionKey('org-relation');
    const result = removeEmbedChatIndexItem('org-relation', first);
    expect(result.replacedWithNew).toBe(true);
    expect(result.index.items).toHaveLength(1);
    expect(result.nextActiveKey).toBe(result.index.items[0]?.key);
    expect(result.nextActiveKey).not.toBe(first);
    expect(result.nextActiveKey).toContain('org-relation--');
  });
});
