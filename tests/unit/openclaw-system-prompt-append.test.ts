import { describe, expect, it } from 'vitest';
import { mergeOpenClawSystemPromptAppend } from '../../electron/engines/openclaw-adapter';
import { prependSystemPromptAppend } from '../../shared/system-prompt-append';
import { DINGTALK_RECIPIENTS_MARKER } from '../../shared/dingtalk-send/dingtalk-mention';

describe('prependSystemPromptAppend / mergeOpenClawSystemPromptAppend', () => {
  it('returns message unchanged when append is empty', () => {
    expect(prependSystemPromptAppend('跑一下天气', undefined)).toBe('跑一下天气');
    expect(mergeOpenClawSystemPromptAppend('跑一下天气', null)).toBe('跑一下天气');
    expect(mergeOpenClawSystemPromptAppend('跑一下天气', '   ')).toBe('跑一下天气');
  });

  it('returns append alone when message is empty', () => {
    expect(prependSystemPromptAppend('', '必发规则')).toBe('必发规则');
    expect(mergeOpenClawSystemPromptAppend('  \n', '必发规则')).toBe('必发规则');
  });

  it('prepends append before the task prompt so recipients are visible to the model', () => {
    const append = [
      DINGTALK_RECIPIENTS_MARKER,
      '```json',
      '{"recipients":[{"type":"user","userId":"u1"}]}',
      '```',
      '定时任务执行场景：以上 JSON 内收件人必须发送',
    ].join('\n');
    const message = '查询上海天气并总结';
    const merged = prependSystemPromptAppend(message, append);

    expect(merged.startsWith(DINGTALK_RECIPIENTS_MARKER)).toBe(true);
    expect(merged).toContain('必须发送');
    expect(merged.endsWith(message)).toBe(true);
    expect(merged).toBe(`${append}\n\n${message}`);
    expect(mergeOpenClawSystemPromptAppend(message, append)).toBe(merged);
  });
});
