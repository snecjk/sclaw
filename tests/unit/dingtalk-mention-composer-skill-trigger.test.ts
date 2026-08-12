import { describe, expect, it } from 'vitest';
import {
  consumeSkillTriggerText,
  consumeSlashTriggerText,
  extractSkillInlineQuery,
  extractSlashInlineQuery,
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

  it('extractSkillInlineQuery respects caret so trailing text is not part of filter', () => {
    // 光标停在 `*` 之后："前*后文" → query 为空，而不是「后文」
    expect(extractSkillInlineQuery('前*后文', 2)).toBe('');
    expect(extractSkillInlineQuery('前*异后文', 3)).toBe('异');
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

describe('dingtalk-mention-composer slash inline trigger', () => {
  it('extractSlashInlineQuery at end of text matches legacy behavior', () => {
    expect(extractSlashInlineQuery('/')).toBe('');
    expect(extractSlashInlineQuery('/流程')).toBe('流程');
    expect(extractSlashInlineQuery('hello/流程')).toBe('流程');
    expect(extractSlashInlineQuery('no trigger')).toBe('');
  });

  it('extractSlashInlineQuery with mid-text caret does not swallow trailing body', () => {
    // 「根据/生成 html」光标紧跟 `/` → 空 query（应展示全量列表）
    const text = '根据/生成 html';
    const caretAfterSlash = text.indexOf('/') + 1;
    expect(extractSlashInlineQuery(text, caretAfterSlash)).toBe('');
    // 光标在 `/流` 之后 → filter 仅为「流」
    expect(extractSlashInlineQuery('根据/流生成 html', '根据/流'.length)).toBe('流');
    // 未传 caret 时仍取到文末（旧行为，供兼容）
    expect(extractSlashInlineQuery('根据/流生成 html')).toBe('流生成 html');
  });

  it('consumeSlashTriggerText with caret only removes / and filter, keeps trailing body', () => {
    const root = document.createElement('div');
    root.appendChild(document.createTextNode('根据/流生成 html'));
    const caret = '根据/流'.length;

    expect(consumeSlashTriggerText(root, '流', caret)).toBe(2);
    expect(serializeMentionEditor(root).plainText).toBe('根据生成 html');
  });
});

describe('dingtalk-mention-composer block newlines', () => {
  it('serializeMentionEditor preserves newlines between contenteditable DIV blocks', () => {
    const root = document.createElement('div');
    const line1 = document.createElement('div');
    line1.textContent = '根据这份数据，帮我生成一份2026年经营报告，要求：';
    const blank = document.createElement('div');
    blank.appendChild(document.createElement('br'));
    const line3 = document.createElement('div');
    line3.textContent = '📊 核心数据';
    const line4 = document.createElement('div');
    line4.textContent = '- 总发件量：2,316,703 件';
    const line5 = document.createElement('div');
    line5.textContent = '- 活跃客户：85 家';
    root.append(line1, blank, line3, line4, line5);

    const snapshot = serializeMentionEditor(root);
    expect(snapshot.plainText).toBe([
      '根据这份数据，帮我生成一份2026年经营报告，要求：',
      '',
      '📊 核心数据',
      '- 总发件量：2,316,703 件',
      '- 活跃客户：85 家',
    ].join('\n'));
    const textSeg = snapshot.segments.find((seg) => seg.type === 'text');
    expect(textSeg?.type === 'text' ? textSeg.text : '').toContain('\n- 总发件量');
  });
});
