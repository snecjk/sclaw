import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmbedChatIndexItem,
  ensureEmbedChatIndex,
  getActiveEmbedChatSessionKey,
  listEmbedChatIndex,
  removeEmbedChatIndexItem,
  setActiveEmbedChatSessionKey,
  touchEmbedChatActivity,
} from '@/lib/sclaw-browser-chat-index';
import { createSclawBrowserChatSessionKeyForApp } from '@/lib/sclaw-browser-chat-session';

describe('sclaw-browser-chat-index', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
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

  it('switches active conversation without bumping last-active time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const first = getActiveEmbedChatSessionKey('org-relation');
    vi.setSystemTime(5_000);
    const { item: second } = createEmbedChatIndexItem('org-relation');
    const firstAt = listEmbedChatIndex('org-relation').items.find((entry) => entry.key === first)?.updatedAt;
    const secondAt = listEmbedChatIndex('org-relation').items.find((entry) => entry.key === second.key)?.updatedAt;

    vi.setSystemTime(9_000);
    setActiveEmbedChatSessionKey('org-relation', first);
    const listed = listEmbedChatIndex('org-relation');
    expect(listed.activeKey).toBe(first);
    expect(listed.items.find((entry) => entry.key === first)?.updatedAt).toBe(firstAt);
    expect(listed.items.find((entry) => entry.key === second.key)?.updatedAt).toBe(secondAt);
    vi.useRealTimers();
  });

  it('bumps last-active time only when the user actually chats', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const first = getActiveEmbedChatSessionKey('org-relation');
    vi.setSystemTime(8_000);
    touchEmbedChatActivity(first);
    expect(listEmbedChatIndex('org-relation').items.find((entry) => entry.key === first)?.updatedAt).toBe(8_000);
    vi.useRealTimers();
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
