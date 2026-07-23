import { describe, expect, it } from 'vitest';
import {
  collectSearchableChatMessages,
  findChatMessageSearchTarget,
  resolveChatMessageSearchKey,
} from '@/pages/Chat/chat-message-search';

describe('resolveChatMessageSearchKey', () => {
  it('uses message:${id} when message.id is present', () => {
    expect(resolveChatMessageSearchKey('abc-1', 'single:k1')).toBe('message:abc-1');
    expect(resolveChatMessageSearchKey('  abc-1  ', 'single:k1')).toBe('message:abc-1');
  });

  it('falls back to stable fallbackKey when message.id is missing', () => {
    expect(resolveChatMessageSearchKey(undefined, 'single:item-42')).toBe('single:item-42');
    expect(resolveChatMessageSearchKey('', 'turn:t1:reply')).toBe('turn:t1:reply');
    expect(resolveChatMessageSearchKey('   ', 'turn:t1:preamble:0')).toBe('turn:t1:preamble:0');
  });

  it('gives different keys for different no-id messages', () => {
    const a = resolveChatMessageSearchKey(undefined, 'single:a');
    const b = resolveChatMessageSearchKey(undefined, 'single:b');
    expect(a).not.toBe(b);
  });
});

describe('collectSearchableChatMessages / findChatMessageSearchTarget', () => {
  function mountMessages(
    entries: Array<{ key: string; text: string }>,
  ): HTMLElement {
    const root = document.createElement('div');
    for (const entry of entries) {
      const node = document.createElement('div');
      node.dataset.chatSearchKey = entry.key;
      node.textContent = entry.text;
      root.appendChild(node);
    }
    return root;
  }

  it('collects messages without backend id via data-chat-search-key', () => {
    const root = mountMessages([
      { key: 'single:no-id-1', text: '今天天气不错' },
      { key: 'message:has-id', text: '有 id 的消息' },
    ]);
    const collected = collectSearchableChatMessages(root);
    expect(collected).toEqual([
      { key: 'single:no-id-1', text: '今天天气不错' },
      { key: 'message:has-id', text: '有 id 的消息' },
    ]);
  });

  it('matches Chinese 天气 and counts once per message even if word repeats', () => {
    const root = mountMessages([
      { key: 'single:a', text: '天气 天气 天气' },
      { key: 'single:b', text: '无关内容' },
    ]);
    const collected = collectSearchableChatMessages(root);
    const matches = collected.filter((entry) =>
      entry.text.toLocaleLowerCase().includes('天气'),
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.key).toBe('single:a');
  });

  it('skips empty text nodes', () => {
    const root = mountMessages([
      { key: 'single:empty', text: '   ' },
      { key: 'single:ok', text: '可见文字' },
    ]);
    expect(collectSearchableChatMessages(root)).toEqual([
      { key: 'single:ok', text: '可见文字' },
    ]);
  });

  it('finds the correct DOM node by searchKey including colons', () => {
    const root = mountMessages([
      { key: 'turn:active-turn:reply', text: '回复' },
      { key: 'message:x:y:z', text: '多段 id' },
    ]);
    const target = findChatMessageSearchTarget(root, 'turn:active-turn:reply');
    expect(target?.textContent).toBe('回复');
    expect(findChatMessageSearchTarget(root, 'message:x:y:z')?.textContent).toBe('多段 id');
    expect(findChatMessageSearchTarget(root, 'missing')).toBeNull();
  });

  it('dedupes duplicate search keys in the DOM', () => {
    const root = mountMessages([
      { key: 'single:dup', text: '第一次' },
      { key: 'single:dup', text: '第二次' },
    ]);
    expect(collectSearchableChatMessages(root)).toEqual([
      { key: 'single:dup', text: '第一次' },
    ]);
  });
});
