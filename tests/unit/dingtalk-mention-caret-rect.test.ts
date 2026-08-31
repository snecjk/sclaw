import { afterEach, describe, expect, it } from 'vitest';
import {
  detectActiveMentionTrigger,
  getClientRectForPlainTextOffset,
  setMentionEditorPlainText,
} from '@/lib/dingtalk-mention-composer';
import { resolveMentionPopoverAnchorRect } from '@/components/dingtalk/mention-popover-anchor-rect';

afterEach(() => {
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
});

function placeCaretAtEnd(root: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

describe('mention caret rect', () => {
  it('returns null in jsdom when layout metrics are unavailable', () => {
    const root = document.createElement('div');
    root.contentEditable = 'true';
    document.body.appendChild(root);
    setMentionEditorPlainText(root, 'hello @abc');
    placeCaretAtEnd(root);

    expect(getClientRectForPlainTextOffset(root, 'hello @abc'.length)).toBeNull();
  });

  it('detects active mention trigger for @ query', () => {
    const root = document.createElement('div');
    root.contentEditable = 'true';
    document.body.appendChild(root);
    setMentionEditorPlainText(root, '联系 @zhang');
    placeCaretAtEnd(root);

    const trigger = detectActiveMentionTrigger(root);
    expect(trigger).toMatchObject({ query: 'zhang' });
  });

  it('resolveMentionPopoverAnchorRect falls back to host when caret rect is unavailable', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    Object.defineProperty(host, 'getBoundingClientRect', {
      value: () => ({
        top: 10,
        left: 20,
        right: 420,
        bottom: 110,
        width: 400,
        height: 100,
        x: 20,
        y: 10,
        toJSON: () => ({}),
      }),
    });

    const rect = resolveMentionPopoverAnchorRect(null, null, host);
    expect(rect).toEqual({
      top: 10,
      left: 20,
      right: 420,
      bottom: 110,
      width: 400,
      height: 100,
    });
  });
});
