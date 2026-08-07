import { describe, expect, it } from 'vitest';
import {
  createSkillSpan,
  consumeSkillTriggerText,
  insertMentionAtTrigger,
  insertSkillSpan,
  MENTION_SPAN_CLASS,
  serializeMentionEditor,
} from '@/lib/dingtalk-mention-composer';

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
});
