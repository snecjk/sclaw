import { afterEach, describe, expect, it } from 'vitest';
import {
  createAttachmentSpan,
  createSkillSpan,
  insertMentionAtTrigger,
  MENTION_SPAN_CLASS,
  resolveTrimmedSkillOffset,
  serializeMentionEditor,
  setMentionEditorSegments,
} from '@/lib/dingtalk-mention-composer';

afterEach(() => {
  document.body.replaceChildren();
});

describe('dingtalk-mention-composer mixed offset consistency', () => {
  it('keeps serialize / skillOffset / trimOffset aligned for file+skill+mention+text', () => {
    const root = document.createElement('div');
    const attachmentId = 'att-mix-1';
    setMentionEditorSegments(
      root,
      [
        { type: 'file', attachmentId },
        { type: 'skill', slug: 'html-design', title: '网页设计' },
        {
          type: 'mention',
          mention: {
            type: 'user',
            displayName: '张三',
            userId: 'uid-1',
          },
        },
        { type: 'text', text: ' 请分析附件' },
      ],
      {
        [attachmentId]: {
          id: attachmentId,
          fileName: 'report.html',
          mimeType: 'text/html',
        },
      },
    );

    const snapshot = serializeMentionEditor(root);
    expect(snapshot.plainText.startsWith(' ')).toBe(false);
    expect(snapshot.plainText).toContain('@张三');
    expect(snapshot.plainText).toContain('请分析附件');
    expect(snapshot.attachmentIds).toEqual([attachmentId]);
    expect(snapshot.skills).toEqual([{ slug: 'html-design', title: '网页设计' }]);
    expect(snapshot.mentions).toHaveLength(1);

    const types = snapshot.segments.map((s) => s.type);
    expect(types.filter((t) => t === 'file')).toHaveLength(1);
    expect(types.filter((t) => t === 'skill')).toHaveLength(1);
    expect(types.filter((t) => t === 'mention')).toHaveLength(1);
    expect(types.indexOf('file')).toBeLessThan(types.indexOf('skill'));
    expect(types.indexOf('skill')).toBeLessThan(types.indexOf('mention'));

    // file/skill 不进 plainText；剥前导空白后 skillOffset 为 0
    expect(snapshot.skillOffset).toBe(0);
    expect(resolveTrimmedSkillOffset(snapshot.plainText, snapshot.skillOffset)).toBe(0);

    const mentionSeg = snapshot.segments.find((s) => s.type === 'mention');
    expect(mentionSeg?.type === 'mention' && mentionSeg.mention.userId).toBe('uid-1');
  });

  it('insertMention after file+skill+text keeps offsets and leaves no stray @', () => {
    const root = document.createElement('div');
    root.appendChild(createAttachmentSpan({
      id: 'att-2',
      fileName: 'a.xlsx',
      mimeType: 'application/vnd.ms-excel',
    }));
    root.appendChild(document.createTextNode('\u00A0'));
    root.appendChild(createSkillSpan('merge-skill', '合并技能'));
    root.appendChild(document.createTextNode('\u00A0正文 @李'));

    const before = serializeMentionEditor(root);
    expect(before.plainText.startsWith(' ')).toBe(false);
    expect(before.skillOffset).toBe(0);
    const atIndex = before.plainText.lastIndexOf('@李');
    expect(atIndex).toBeGreaterThanOrEqual(0);

    insertMentionAtTrigger(
      root,
      { query: '李', startOffset: atIndex, endOffset: atIndex + 2 },
      {
        type: 'user',
        displayName: '李峥',
        userId: 'uid-2',
      },
    );

    const after = serializeMentionEditor(root);
    expect(after.attachmentIds).toEqual(['att-2']);
    expect(after.skills[0]?.slug).toBe('merge-skill');
    expect(after.mentions).toEqual([
      { type: 'user', displayName: '李峥', userId: 'uid-2' },
    ]);
    expect(after.plainText).toContain('@李峥');
    expect(after.plainText.includes('@李') && !after.plainText.includes('@李峥')).toBe(false);
    // 触发串 `@李` 已被 mention token 替换，正文不再残留裸 `@`
    expect(after.plainText).toMatch(/正文\s*@李峥/);
    expect(after.skillOffset).toBe(0);
    expect(resolveTrimmedSkillOffset(after.plainText, after.skillOffset)).toBe(0);
    expect(root.querySelectorAll(`span.${MENTION_SPAN_CLASS}`)).toHaveLength(1);

    const leftoverTriggerAt = Array.from(root.childNodes).some(
      (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').includes('@'),
    );
    expect(leftoverTriggerAt).toBe(false);
  });

  it('resolveTrimmedSkillOffset clamps after leading whitespace on mixed body', () => {
    expect(resolveTrimmedSkillOffset('  hello', 2)).toBe(0);
    expect(resolveTrimmedSkillOffset('  hello', 4)).toBe(2);
    expect(resolveTrimmedSkillOffset('hello', 0)).toBe(0);
    expect(resolveTrimmedSkillOffset('hello', undefined)).toBeUndefined();
  });
});
