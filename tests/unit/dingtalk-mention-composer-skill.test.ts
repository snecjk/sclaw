import { describe, expect, it } from 'vitest';
import {
  createSkillSpan,
  insertSkillSpan,
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
});
