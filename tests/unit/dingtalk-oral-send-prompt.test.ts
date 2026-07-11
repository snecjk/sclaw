import { describe, expect, it } from 'vitest';
import {
  looksLikeDingTalkOralSendIntent,
} from '../../shared/dingtalk-oral-send-prompt';

describe('looksLikeDingTalkOralSendIntent', () => {
  it('matches named recipient send phrases', () => {
    expect(looksLikeDingTalkOralSendIntent('发一条上海明天的天气给文鹏')).toBe(true);
    expect(looksLikeDingTalkOralSendIntent('发给文鹏')).toBe(true);
    expect(looksLikeDingTalkOralSendIntent('给文鹏发消息')).toBe(true);
    expect(looksLikeDingTalkOralSendIntent('把报告发送给张三')).toBe(true);
  });

  it('rejects unrelated or picker-only phrases', () => {
    expect(looksLikeDingTalkOralSendIntent('今天天气怎么样')).toBe(false);
    expect(looksLikeDingTalkOralSendIntent('分享到钉钉')).toBe(false);
    expect(looksLikeDingTalkOralSendIntent('')).toBe(false);
  });
});
