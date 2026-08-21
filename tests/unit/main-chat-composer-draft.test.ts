import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearMainChatComposerDraft,
  mergeMainChatDraft,
  publishMainChatComposerDraft,
  readMainChatComposerDraft,
} from '@/lib/main-chat-composer-draft';

describe('main chat composer draft mirror', () => {
  beforeEach(() => {
    clearMainChatComposerDraft();
  });

  it('reads back what the composer published', () => {
    expect(readMainChatComposerDraft()).toBe('');
    publishMainChatComposerDraft('写周报');
    expect(readMainChatComposerDraft()).toBe('写周报');
  });

  it('reports an empty draft once the composer unmounts', () => {
    publishMainChatComposerDraft('写周报');
    clearMainChatComposerDraft();
    expect(readMainChatComposerDraft()).toBe('');
  });
});

describe('mergeMainChatDraft', () => {
  it('replaces an existing draft in REPLACE mode', () => {
    expect(mergeMainChatDraft('旧草稿', '  新草稿  ', 'REPLACE')).toBe('新草稿');
  });

  it('appends after the existing draft with a clear separator', () => {
    expect(mergeMainChatDraft('旧草稿', '新草稿', 'APPEND')).toBe('旧草稿\n\n新草稿');
  });

  it('does not leave trailing whitespace from the existing draft in the separator', () => {
    expect(mergeMainChatDraft('旧草稿  \n', '新草稿', 'APPEND')).toBe('旧草稿\n\n新草稿');
  });

  it('writes without a leading separator when the draft is empty', () => {
    expect(mergeMainChatDraft('', '新草稿', 'APPEND')).toBe('新草稿');
    expect(mergeMainChatDraft('   \n\t', '新草稿', 'APPEND')).toBe('新草稿');
  });
});
