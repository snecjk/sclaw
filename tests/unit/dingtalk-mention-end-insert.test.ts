import { afterEach, describe, expect, it } from 'vitest';
import {
  detectActiveMentionTrigger,
  insertMentionAtTrigger,
  insertWorkflowSpan,
  serializeMentionEditor,
  setMentionEditorSegments,
  ensureTrailingCaretAnchor,
  insertLineBreakAtCaret,
  WORKFLOW_SPAN_SELECTOR,
} from '@/lib/dingtalk-mention-composer';

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

describe('end mention + workflow inline insert', () => {
  it('insertMention at very end after workflow/mention chips', () => {
    const root = document.createElement('div');
    root.contentEditable = 'true';
    document.body.appendChild(root);

    setMentionEditorSegments(root, [
      { type: 'text', text: '然后' },
      { type: 'workflow', id: 'wf_1', name: 'Cold knowledge-123', source: 'mine' },
      { type: 'text', text: '发送给' },
      { type: 'mention', mention: { type: 'user', displayName: '申通sclaw123', userId: 'u1' } },
      { type: 'text', text: '\n再查一下上海青浦的天气发送给 @houzhengya' },
    ]);

    const plain = serializeMentionEditor(root).plainText;
    const startOffset = plain.lastIndexOf('@houzhengya');
    expect(startOffset).toBeGreaterThanOrEqual(0);
    const endOffset = startOffset + '@houzhengya'.length;

    insertMentionAtTrigger(
      root,
      { query: 'houzhengya', startOffset, endOffset },
      { type: 'user', displayName: '侯正亚', userId: 'u2' },
    );

    const snap = serializeMentionEditor(root);
    expect(snap.mentions.map((m) => m.displayName)).toContain('侯正亚');
    expect(snap.plainText).not.toContain('@houzhengya');
  });

  it('falls back to DOM scan when plainText offsets are stale at end', () => {
    const root = document.createElement('div');
    root.contentEditable = 'true';
    document.body.appendChild(root);
    root.appendChild(document.createTextNode('发送给 @houzhengya'));
    placeCaretAtEnd(root);

    // Deliberately wrong offsets — should still resolve via DOM fallback
    insertMentionAtTrigger(
      root,
      { query: 'houzhengya', startOffset: 999, endOffset: 1010 },
      { type: 'user', displayName: '侯正亚', userId: 'u2' },
    );

    const snap = serializeMentionEditor(root);
    expect(snap.mentions.map((m) => m.displayName)).toContain('侯正亚');
    expect(snap.plainText).not.toContain('@houzhengya');
  });

  it('detect + insert when trailing anchor exists after last chip then typed @', () => {
    const root = document.createElement('div');
    root.contentEditable = 'true';
    document.body.appendChild(root);

    setMentionEditorSegments(root, [
      { type: 'text', text: '发送给' },
      { type: 'mention', mention: { type: 'user', displayName: '甲', userId: 'u1' } },
    ]);
    while (root.lastChild && root.lastChild.nodeType === Node.TEXT_NODE) {
      root.lastChild.remove();
    }
    ensureTrailingCaretAnchor(root);
    const anchor = root.lastChild as Text;
    anchor.data = `${anchor.data}@houzhengya`;
    placeCaretAtEnd(root);

    const trigger = detectActiveMentionTrigger(root);
    expect(trigger).not.toBeNull();

    insertMentionAtTrigger(
      root,
      trigger!,
      { type: 'user', displayName: '侯正亚', userId: 'u2' },
    );

    const snap = serializeMentionEditor(root);
    expect(snap.mentions.map((m) => m.displayName)).toContain('侯正亚');
    expect(snap.plainText).not.toContain('@houzhengya');
  });

  it('insertWorkflow after 然后 does not insert BR between them', () => {
    const root = document.createElement('div');
    root.contentEditable = 'true';
    document.body.appendChild(root);
    const text = document.createTextNode('然后');
    root.appendChild(text);
    const range = document.createRange();
    range.setStart(text, text.length);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    insertWorkflowSpan(root, 'wf_1', 'Cold knowledge-123', 'mine');

    expect(root.querySelector(WORKFLOW_SPAN_SELECTOR)).not.toBeNull();
    expect(root.innerHTML).not.toMatch(/然后\s*<br/i);
  });

  it('inserts workflow before Chrome trailing BR so 你好 and chip stay on one line', () => {
    const root = document.createElement('div');
    root.contentEditable = 'true';
    document.body.appendChild(root);

    const first = document.createTextNode('你好');
    root.appendChild(first);
    insertWorkflowSpan(root, 'wf_a', '再来1000条数据 10:52', 'mine');

    const line = document.createElement('div');
    const text = document.createTextNode('你好');
    const br = document.createElement('br');
    line.append(text, br);
    root.appendChild(line);

    const range = document.createRange();
    range.setStart(text, text.length);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    insertWorkflowSpan(root, 'wf_b', 'Cold knowledge-123', 'mine');

    const token = line.querySelector(WORKFLOW_SPAN_SELECTOR);
    expect(token).not.toBeNull();
    expect(token?.previousSibling).toBe(text);
    expect(line.contains(br)).toBe(true);
  });

  it('does not pull a new-line workflow back onto the previous paragraph', () => {
    const root = document.createElement('div');
    root.contentEditable = 'true';
    document.body.appendChild(root);

    const prev = document.createElement('div');
    prev.append(document.createTextNode('你好'), document.createElement('br'));
    const next = document.createElement('div');
    next.appendChild(document.createElement('br'));
    root.append(prev, next);

    const range = document.createRange();
    range.setStart(next, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    insertWorkflowSpan(root, 'wf_b', 'Cold knowledge-123', 'mine');

    expect(next.querySelector(WORKFLOW_SPAN_SELECTOR)).not.toBeNull();
    expect(prev.querySelector(WORKFLOW_SPAN_SELECTOR)).toBeNull();
  });

  it('insertLineBreak uses BR instead of a new DIV', () => {
    const root = document.createElement('div');
    root.contentEditable = 'true';
    document.body.appendChild(root);
    const text = document.createTextNode('你好');
    root.appendChild(text);
    placeCaretAtEnd(root);

    insertLineBreakAtCaret(root);

    expect(root.querySelector('div')).toBeNull();
    expect(root.querySelector('br')).not.toBeNull();
    expect(serializeMentionEditor(root).plainText).toContain('\n');
  });
});
