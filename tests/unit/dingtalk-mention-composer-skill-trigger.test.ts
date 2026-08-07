import { describe, expect, it } from 'vitest';
import {
  consumeSkillTriggerText,
  extractSkillInlineQuery,
  hasSkillInlineTrigger,
  insertSkillSpan,
  serializeMentionEditor,
} from '@/lib/dingtalk-mention-composer';

describe('dingtalk-mention-composer skill inline trigger', () => {
  it('extractSkillInlineQuery returns text after last asterisk', () => {
    expect(extractSkillInlineQuery('*异常')).toBe('异常');
    expect(extractSkillInlineQuery('hello*异常')).toBe('异常');
    expect(extractSkillInlineQuery('*')).toBe('');
    expect(extractSkillInlineQuery('no trigger')).toBe('');
  });

  it('hasSkillInlineTrigger detects asterisk in plain text', () => {
    expect(hasSkillInlineTrigger('*异常')).toBe(true);
    expect(hasSkillInlineTrigger('plain')).toBe(false);
  });

  it('consumeSkillTriggerText removes asterisk and explicit filter query only', () => {
    const root = document.createElement('div');
    root.appendChild(document.createTextNode('*异常'));
    root.appendChild(document.createTextNode('补充说明'));

    expect(consumeSkillTriggerText(root, '异常')).toBe(0);
    expect(serializeMentionEditor(root).plainText).toBe('补充说明');
  });

  it('consumeSkillTriggerText removes asterisk and inferred filter when query omitted', () => {
    const root = document.createElement('div');
    root.appendChild(document.createTextNode('*异常'));

    expect(consumeSkillTriggerText(root)).toBe(0);
    expect(serializeMentionEditor(root).plainText).toBe('');
  });

  it('consumeSkillTriggerText returns null when no asterisk', () => {
    const root = document.createElement('div');
    root.appendChild(document.createTextNode('plain text'));
    expect(consumeSkillTriggerText(root)).toBeNull();
  });

  it('picker select flow: consume trigger then insert skill leaves clean plainText', () => {
    const root = document.createElement('div');
    root.appendChild(document.createTextNode('*异常'));

    const offset = consumeSkillTriggerText(root, '异常');
    insertSkillSpan(root, 'skill-a', '异常客户跟踪', offset ?? undefined);
    root.appendChild(document.createTextNode('帮我查一下'));

    const snapshot = serializeMentionEditor(root);
    expect(snapshot.skill).toEqual({ slug: 'skill-a', title: '异常客户跟踪' });
    expect(snapshot.plainText).toBe('帮我查一下');
    expect(snapshot.plainText).not.toContain('*');
    expect(snapshot.plainText).not.toContain('异常');
  });
});
