import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';
import type { DingTalkMentionEditorHandle } from '@/components/dingtalk/DingTalkMentionEditor';
import { EMPTY_MENTION_COMPOSER_SNAPSHOT } from '@/lib/dingtalk-mention-composer';
import {
  readSessionComposerDraft,
  resetComposerSessionDraftsForTests,
} from '@/lib/composer-session-draft';
import { useComposerSessionDraft } from '@/components/input-composer/use-composer-session-draft';

const PLAZA_SESSION_KEY = 'agent:main:session-embed-app-demo';

function createEditor(initialText = '') {
  let text = initialText;
  const editor: Pick<
    DingTalkMentionEditorHandle,
    'clear' | 'setPlainText' | 'setSegments' | 'getSnapshot'
  > = {
    clear: vi.fn(() => {
      text = '';
    }),
    setPlainText: vi.fn((next: string) => {
      text = next;
    }),
    setSegments: vi.fn((segments) => {
      text = segments
        .filter((segment): segment is { type: 'text'; text: string } => segment.type === 'text')
        .map((segment) => segment.text)
        .join('');
    }),
    getSnapshot: vi.fn(() => ({
      ...EMPTY_MENTION_COMPOSER_SNAPSHOT,
      plainText: text,
      segments: text ? [{ type: 'text' as const, text }] : [],
      isEmpty: !text.trim(),
    })),
  };
  return editor as DingTalkMentionEditorHandle;
}

describe('useComposerSessionDraft', () => {
  beforeEach(() => {
    resetComposerSessionDraftsForTests();
  });

  it('parks one session draft and restores it when switching back', () => {
    const editor = createEditor();
    const mentionEditorRef = { current: editor } as RefObject<DingTalkMentionEditorHandle | null>;
    const onBeforeRestore = vi.fn();

    const { rerender } = renderHook(
      ({ sessionKey, snapshot }) => useComposerSessionDraft({
        sessionKey,
        mentionEditorRef,
        snapshot,
        onBeforeRestore,
      }),
      {
        initialProps: {
          sessionKey: 'agent:main:a',
          snapshot: EMPTY_MENTION_COMPOSER_SNAPSHOT,
        },
      },
    );

    expect(editor.clear).not.toHaveBeenCalled();

    act(() => {
      rerender({
        sessionKey: 'agent:main:b',
        snapshot: {
          ...EMPTY_MENTION_COMPOSER_SNAPSHOT,
          plainText: 'hello-a',
          isEmpty: false,
        },
      });
    });
    expect(editor.clear).toHaveBeenCalled();

    act(() => {
      (editor.setPlainText as ReturnType<typeof vi.fn>).mockClear();
      rerender({
        sessionKey: 'agent:main:a',
        snapshot: EMPTY_MENTION_COMPOSER_SNAPSHOT,
      });
    });
    expect(editor.setPlainText).toHaveBeenCalledWith('hello-a');
    expect(onBeforeRestore).toHaveBeenCalled();
  });

  it('does not overwrite a seed on first mount', () => {
    const editor = createEditor();
    const mentionEditorRef = { current: editor } as RefObject<DingTalkMentionEditorHandle | null>;

    renderHook(() => useComposerSessionDraft({
      sessionKey: 'agent:main:a',
      seedText: 'from-router',
      mentionEditorRef,
      snapshot: EMPTY_MENTION_COMPOSER_SNAPSHOT,
    }));

    expect(editor.clear).not.toHaveBeenCalled();
    expect(editor.setPlainText).not.toHaveBeenCalled();
  });

  it('does not restore plaza drafts into the home editor', () => {
    const editor = createEditor();
    const mentionEditorRef = { current: editor } as RefObject<DingTalkMentionEditorHandle | null>;

    const { rerender } = renderHook(
      ({ sessionKey, snapshot }) => useComposerSessionDraft({
        sessionKey,
        mentionEditorRef,
        snapshot,
      }),
      {
        initialProps: {
          sessionKey: 'agent:main:a',
          snapshot: EMPTY_MENTION_COMPOSER_SNAPSHOT,
        },
      },
    );

    act(() => {
      rerender({
        sessionKey: PLAZA_SESSION_KEY,
        snapshot: {
          ...EMPTY_MENTION_COMPOSER_SNAPSHOT,
          plainText: '1222',
          isEmpty: false,
        },
      });
    });

    expect(editor.clear).not.toHaveBeenCalled();
    expect(editor.setPlainText).not.toHaveBeenCalled();
    expect(readSessionComposerDraft('agent:main:a')?.plainText).toBe('1222');
  });

  it('does not let an isolated plaza composer wipe the home draft', () => {
    const homeEditor = createEditor();
    const homeRef = { current: homeEditor } as RefObject<DingTalkMentionEditorHandle | null>;
    const home = renderHook(
      ({ snapshot }) => useComposerSessionDraft({
        sessionKey: 'agent:main:a',
        mentionEditorRef: homeRef,
        snapshot,
      }),
      {
        initialProps: {
          snapshot: {
            ...EMPTY_MENTION_COMPOSER_SNAPSHOT,
            plainText: '1222',
            isEmpty: false,
          },
        },
      },
    );
    home.unmount();
    expect(readSessionComposerDraft('agent:main:a')?.plainText).toBe('1222');

    const plazaEditor = createEditor();
    const plazaRef = { current: plazaEditor } as RefObject<DingTalkMentionEditorHandle | null>;
    const plaza = renderHook(() => useComposerSessionDraft({
      sessionKey: PLAZA_SESSION_KEY,
      isolateToSessionKey: true,
      mentionEditorRef: plazaRef,
      snapshot: EMPTY_MENTION_COMPOSER_SNAPSHOT,
    }));
    expect(readSessionComposerDraft('agent:main:a')?.plainText).toBe('1222');
    expect(plazaEditor.clear).not.toHaveBeenCalled();
    plaza.unmount();

    const restoredEditor = createEditor();
    const restoredRef = { current: restoredEditor } as RefObject<DingTalkMentionEditorHandle | null>;
    renderHook(() => useComposerSessionDraft({
      sessionKey: 'agent:main:a',
      mentionEditorRef: restoredRef,
      snapshot: EMPTY_MENTION_COMPOSER_SNAPSHOT,
    }));
    expect(restoredEditor.setPlainText).toHaveBeenCalledWith('1222');
  });
});
