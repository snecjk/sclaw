import { describe, expect, it } from 'vitest';
import { sanitizeMemoryCaptureUserMessage } from '../../shared/memory-capture-text';

describe('sanitizeMemoryCaptureUserMessage', () => {
  it('keeps a normal user message unchanged', () => {
    expect(sanitizeMemoryCaptureUserMessage('记住我喜欢简洁回答')).toBe('记住我喜欢简洁回答');
  });

  it('uses durable skill marker user text instead of the skill prompt', () => {
    const raw = [
      '你是一个很长的技能系统提示。',
      '帮我分析本周销售数据',
      '<!-- SClaw-Skill {"slug":"sales","title":"销售分析","userText":"帮我分析本周销售数据"} -->',
    ].join('\n');
    expect(sanitizeMemoryCaptureUserMessage(raw)).toBe('帮我分析本周销售数据');
  });

  it('falls back to the skill title when the user did not type extra text', () => {
    const raw = '技能默认提示\n<!-- SClaw-Skill {"slug":"sales","title":"销售分析"} -->';
    expect(sanitizeMemoryCaptureUserMessage(raw)).toBe('销售分析');
  });

  it('removes injected memory and workflow contexts', () => {
    const raw = [
      '原始问题',
      '<!-- StoClaw-Agent-Memory -->',
      '内部记忆',
      '<!-- StoClaw-Agent-Memory -->',
      '<!-- StoClaw-Workflow-Session -->',
      '内部工作流提示',
      '<!-- StoClaw-Workflow-Session -->',
    ].join('\n');
    expect(sanitizeMemoryCaptureUserMessage(raw)).toBe('原始问题');
  });
});
