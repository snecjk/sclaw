import { afterEach, describe, expect, it } from 'vitest';
import {
  createAttachmentSpan,
  createSkillSpan,
  consumeSkillTriggerText,
  focusMentionEditorAtEnd,
  insertMentionAtTrigger,
  insertSkillSpan,
  MENTION_SPAN_CLASS,
  readCaretPlainTextOffset,
  serializeMentionEditor,
  setMentionEditorSegments,
} from '@/lib/dingtalk-mention-composer';

afterEach(() => {
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
});

describe('dingtalk-mention-composer skill token', () => {
  it('does not include skill token text in plainText', () => {
    const root = document.createElement('div');
    insertSkillSpan(root, 'hq-settlement', '总部结算对账');
    root.appendChild(document.createTextNode('帮我查上月数据'));

    const snapshot = serializeMentionEditor(root);
    expect(snapshot.plainText).toBe('帮我查上月数据');
    expect(snapshot.skill).toEqual({ slug: 'hq-settlement', title: '总部结算对账' });
    expect(snapshot.isEmpty).toBe(false);
  });

  it('isEmpty is false when only skill token is present', () => {
    const root = document.createElement('div');
    insertSkillSpan(root, 'hq-settlement', '总部结算对账');

    const snapshot = serializeMentionEditor(root);
    expect(snapshot.plainText).toBe('');
    expect(snapshot.skill?.slug).toBe('hq-settlement');
    expect(snapshot.isEmpty).toBe(false);
  });

  it('createSkillSpan uses title as visible label', () => {
    const span = createSkillSpan('slug-a', '技能名称');
    expect(span.dataset.skillSlug).toBe('slug-a');
    expect(span.dataset.skillTitle).toBe('技能名称');
    expect(span.querySelector('.skill-token-label')?.textContent).toBe('技能名称');
  });

  it('serializes skill token when class token is missing but data-skill-slug remains', () => {
    const root = document.createElement('div');
    const span = createSkillSpan('hq-settlement', '总部结算对账');
    span.classList.remove('skill-token');
    root.appendChild(span);

    const snapshot = serializeMentionEditor(root);
    expect(snapshot.skill).toEqual({ slug: 'hq-settlement', title: '总部结算对账' });
    expect(snapshot.isEmpty).toBe(false);
  });

  it('insertSkill after consuming inline trigger has no asterisk residue in plainText', () => {
    const root = document.createElement('div');
    root.appendChild(document.createTextNode('*异常'));
    consumeSkillTriggerText(root);
    insertSkillSpan(root, 'hq-settlement', '总部结算对账');

    const snapshot = serializeMentionEditor(root);
    expect(snapshot.skill).toEqual({ slug: 'hq-settlement', title: '总部结算对账' });
    expect(snapshot.plainText).not.toContain('*');
  });

  it('insertMention after skill does not leave a stray @ from offset mismatch', () => {
    const root = document.createElement('div');
    insertSkillSpan(root, 'outbound-fee', '网点出港派费');
    // skill 插入后尾随 NBSP；用户在同一文本节点继续输入 @（与真实 contenteditable 一致）
    const spacer = root.childNodes[1] as Text;
    spacer.data = `${spacer.data}@`;

    insertMentionAtTrigger(
      root,
      { query: '', startOffset: 0, endOffset: 1 },
      {
        type: 'group',
        displayName: '虎盾2.9替代OpenVPN答疑群',
        openConversationId: 'cid-1',
      },
    );

    const snapshot = serializeMentionEditor(root);
    expect(snapshot.skill?.slug).toBe('outbound-fee');
    expect(snapshot.mentions).toHaveLength(1);
    expect(snapshot.plainText.replace(/\s+$/, '')).toBe('@虎盾2.9替代OpenVPN答疑群');
    expect(root.querySelectorAll(`span.${MENTION_SPAN_CLASS}`)).toHaveLength(1);
    const leftoverAt = Array.from(root.childNodes).some(
      (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').includes('@'),
    );
    expect(leftoverAt).toBe(false);
  });

  it('insertMention after file+skill (edit draft) maps @ offsets correctly', () => {
    const root = document.createElement('div');
    const attachmentId = 'att-edit-1';
    setMentionEditorSegments(
      root,
      [
        { type: 'file', attachmentId },
        { type: 'skill', slug: 'html-design', title: '姚磊html网页设计' },
        { type: 'text', text: '再帮我重新分析这个文件 @123' },
      ],
      {
        [attachmentId]: {
          id: attachmentId,
          fileName: '网点件量数据看板.html',
          mimeType: 'text/html',
        },
      },
    );

    const before = serializeMentionEditor(root);
    expect(before.plainText.startsWith(' ')).toBe(false);
    expect(before.skillOffset).toBe(0);
    const atIndex = before.plainText.lastIndexOf('@123');
    expect(atIndex).toBeGreaterThanOrEqual(0);

    insertMentionAtTrigger(
      root,
      { query: '123', startOffset: atIndex, endOffset: atIndex + 4 },
      {
        type: 'group',
        displayName: '申通sclaw123',
        openConversationId: 'cid-group-1',
      },
    );

    const snapshot = serializeMentionEditor(root);
    expect(snapshot.attachmentIds).toEqual([attachmentId]);
    expect(snapshot.skill?.slug).toBe('html-design');
    expect(snapshot.mentions).toHaveLength(1);
    expect(snapshot.mentions[0]?.displayName).toBe('申通sclaw123');
    expect(snapshot.plainText).toContain('@申通sclaw123');
    expect(snapshot.plainText).not.toContain('@123');
    expect(root.querySelectorAll(`span.${MENTION_SPAN_CLASS}`)).toHaveLength(1);
  });

  it('serialize strips leading token spacers when file precedes skill', () => {
    const root = document.createElement('div');
    root.appendChild(createAttachmentSpan({
      id: 'att-1',
      fileName: 'demo.html',
      mimeType: 'text/html',
    }));
    root.appendChild(document.createTextNode('\u00A0'));
    root.appendChild(createSkillSpan('html-design', '姚磊html网页设计'));
    root.appendChild(document.createTextNode('\u00A0正文'));

    const snapshot = serializeMentionEditor(root);
    expect(snapshot.plainText).toBe('正文');
    expect(snapshot.skillOffset).toBe(0);
    expect(snapshot.segments[0]?.type).toBe('file');
  });

  it('focusMentionEditorAtEnd places caret after skill+text fill', () => {
    const root = document.createElement('div');
    root.contentEditable = 'true';
    document.body.appendChild(root);

    setMentionEditorSegments(root, [
      { type: 'skill', slug: 'quote-assistant', title: '报价助手' },
      { type: 'text', text: '帮我新建报价' },
    ]);
    focusMentionEditorAtEnd(root);
    expect(readCaretPlainTextOffset(root)).toBe('帮我新建报价'.length);
  });

  it('focusMentionEditorAtEnd places caret after skill-only fill', () => {
    const root = document.createElement('div');
    root.contentEditable = 'true';
    document.body.appendChild(root);

    setMentionEditorSegments(root, [
      { type: 'skill', slug: 'quote-assistant', title: '报价助手' },
    ]);
    focusMentionEditorAtEnd(root);
    expect(readCaretPlainTextOffset(root)).toBe(0);
    expect(root.lastChild?.nodeType).toBe(Node.TEXT_NODE);
    const selection = window.getSelection();
    expect(selection?.rangeCount).toBe(1);
    const range = selection!.getRangeAt(0);
    expect(range.collapsed).toBe(true);
    expect(range.startContainer).toBe(root.lastChild);
    expect(range.startOffset).toBe(root.lastChild?.textContent?.length ?? 0);
  });
});
