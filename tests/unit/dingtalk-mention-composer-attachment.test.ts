import { afterEach, describe, expect, it } from 'vitest';
import {
  createAttachmentSpan,
  insertAttachmentSpan,
  insertSkillSpan,
  removeAttachmentSpan,
  serializeMentionEditor,
  setMentionEditorSegments,
  ATTACHMENT_SPAN_SELECTOR,
} from '@/lib/dingtalk-mention-composer';

afterEach(() => {
  document.body.replaceChildren();
});

describe('dingtalk-mention-composer attachment token', () => {
  it('serializes file segments without adding filename to plainText', () => {
    const root = document.createElement('div');
    insertAttachmentSpan(root, {
      id: 'att-1',
      fileName: '报表.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    root.appendChild(document.createTextNode('请分析'));

    const snapshot = serializeMentionEditor(root);
    expect(snapshot.plainText).toBe('请分析');
    expect(snapshot.attachmentIds).toEqual(['att-1']);
    expect(snapshot.segments).toEqual([
      { type: 'file', attachmentId: 'att-1' },
      { type: 'text', text: '请分析' },
    ]);
    expect(snapshot.isEmpty).toBe(false);
  });

  it('allows multiple skills to append', () => {
    const root = document.createElement('div');
    insertSkillSpan(root, 'skill-a', '技能A');
    insertSkillSpan(root, 'skill-b', '技能B');

    const snapshot = serializeMentionEditor(root);
    expect(snapshot.skills).toHaveLength(2);
    expect(snapshot.skill?.slug).toBe('skill-a');
    expect(snapshot.segments.filter((s) => s.type === 'skill')).toHaveLength(2);
  });

  it('mixes file, text, and skill segments in order', () => {
    const root = document.createElement('div');
    insertAttachmentSpan(root, { id: 'a1', fileName: 'a.xlsx', mimeType: 'application/vnd.ms-excel' });
    root.appendChild(document.createTextNode(' 合并 '));
    insertSkillSpan(root, 'merge-skill', '合并技能');

    const snapshot = serializeMentionEditor(root);
    expect(snapshot.attachmentIds).toEqual(['a1']);
    expect(snapshot.skills).toHaveLength(1);
    expect(snapshot.segments.map((s) => s.type)).toEqual(['file', 'text', 'skill', 'text']);
  });

  it('removeAttachmentSpan removes the token and trailing separator', () => {
    const root = document.createElement('div');
    insertAttachmentSpan(root, { id: 'att-del', fileName: '待删.pdf', mimeType: 'application/pdf' });

    expect(root.querySelectorAll(ATTACHMENT_SPAN_SELECTOR)).toHaveLength(1);
    removeAttachmentSpan(root, 'att-del');
    expect(root.querySelectorAll(ATTACHMENT_SPAN_SELECTOR)).toHaveLength(0);
    expect(serializeMentionEditor(root).isEmpty).toBe(true);
  });

  it('createAttachmentSpan includes remove button and dataset', () => {
    const span = createAttachmentSpan({
      id: 'att-2',
      fileName: '长文件名应该被截断显示.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      status: 'staging',
    });
    expect(span.dataset.attachmentId).toBe('att-2');
    expect(span.querySelector('[data-attachment-remove]')).not.toBeNull();
    expect(span.querySelector('.attachment-token-label')?.textContent).toBe('长文件名应该被截断显示.docx');
  });

  it('setMentionEditorSegments rebuilds mixed content from segments', () => {
    const root = document.createElement('div');
    setMentionEditorSegments(
      root,
      [
        { type: 'file', attachmentId: 'att-3' },
        { type: 'text', text: ' 正文 ' },
        { type: 'skill', slug: 's1', title: '技能一' },
      ],
      {
        'att-3': {
          id: 'att-3',
          fileName: 'data.csv',
          mimeType: 'text/csv',
        },
      },
    );

    const snapshot = serializeMentionEditor(root);
    expect(snapshot.attachmentIds).toEqual(['att-3']);
    expect(snapshot.plainText.trim()).toBe('正文');
    expect(snapshot.skills[0]?.slug).toBe('s1');
  });
});
