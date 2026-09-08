import { beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_MENTION_COMPOSER_SNAPSHOT } from '@/lib/dingtalk-mention-composer';
import {
  clearSessionComposerDraft,
  isParkedComposerDraftEmpty,
  readSessionComposerDraft,
  resetComposerSessionDraftsForTests,
  saveSessionComposerDraft,
  toParkedComposerDraft,
} from '@/lib/composer-session-draft';

describe('composer session drafts', () => {
  beforeEach(() => {
    resetComposerSessionDraftsForTests();
  });

  it('saves and reads a draft by session key', () => {
    saveSessionComposerDraft('agent:main:a', {
      ...EMPTY_MENTION_COMPOSER_SNAPSHOT,
      plainText: '1222',
      segments: [{ type: 'text', text: '1222' }],
      isEmpty: false,
    });
    expect(readSessionComposerDraft('agent:main:a')?.plainText).toBe('1222');
    expect(readSessionComposerDraft('agent:main:b')).toBeNull();
  });

  it('clears a parked draft', () => {
    saveSessionComposerDraft('agent:main:a', {
      ...EMPTY_MENTION_COMPOSER_SNAPSHOT,
      plainText: '1222',
      isEmpty: false,
    });
    clearSessionComposerDraft('agent:main:a');
    expect(readSessionComposerDraft('agent:main:a')).toBeNull();
  });

  it('treats whitespace-only text as empty', () => {
    const draft = toParkedComposerDraft({
      ...EMPTY_MENTION_COMPOSER_SNAPSHOT,
      plainText: '   \n',
    });
    expect(isParkedComposerDraftEmpty(draft)).toBe(true);
  });

  it('does not let an empty snapshot wipe a parked draft', () => {
    saveSessionComposerDraft('agent:main:a', {
      ...EMPTY_MENTION_COMPOSER_SNAPSHOT,
      plainText: '1222',
      isEmpty: false,
    });
    saveSessionComposerDraft('agent:main:a', EMPTY_MENTION_COMPOSER_SNAPSHOT);
    expect(readSessionComposerDraft('agent:main:a')?.plainText).toBe('1222');
  });

  it('clears a parked draft when the same editor opts into empty overwrite', () => {
    saveSessionComposerDraft('agent:main:a', {
      ...EMPTY_MENTION_COMPOSER_SNAPSHOT,
      plainText: '1222',
      isEmpty: false,
    });
    saveSessionComposerDraft('agent:main:a', EMPTY_MENTION_COMPOSER_SNAPSHOT, { clearIfEmpty: true });
    expect(readSessionComposerDraft('agent:main:a')).toBeNull();
  });

  it('drops file segments so parked drafts stay text/chips only', () => {
    const draft = toParkedComposerDraft({
      ...EMPTY_MENTION_COMPOSER_SNAPSHOT,
      plainText: '看这个',
      segments: [
        { type: 'text', text: '看这个' },
        { type: 'file', attachmentId: 'att-1' },
        { type: 'skill', slug: 'foo', title: 'Foo' },
      ],
      isEmpty: false,
    });
    expect(draft.segments).toEqual([
      { type: 'text', text: '看这个' },
      { type: 'skill', slug: 'foo', title: 'Foo' },
    ]);
    expect(isParkedComposerDraftEmpty(draft)).toBe(false);
  });

  it('evicts the oldest draft once the cap is exceeded', () => {
    for (let i = 0; i < 51; i += 1) {
      saveSessionComposerDraft(`session:${i}`, {
        ...EMPTY_MENTION_COMPOSER_SNAPSHOT,
        plainText: `draft-${i}`,
        isEmpty: false,
      });
    }
    expect(readSessionComposerDraft('session:0')).toBeNull();
    expect(readSessionComposerDraft('session:1')?.plainText).toBe('draft-1');
    expect(readSessionComposerDraft('session:50')?.plainText).toBe('draft-50');
  });
});
