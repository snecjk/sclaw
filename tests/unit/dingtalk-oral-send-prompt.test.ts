import { describe, expect, it } from 'vitest';
import {
  DINGTALK_ORAL_SEND_GUARD,
  DINGTALK_ORAL_SEND_PROMPT,
  looksLikeDingTalkOralSendIntent,
} from '../../shared/dingtalk-prompts/dingtalk-oral-send-prompt';
import { DINGTALK_ORAL_SEND_GUARD as GUARD_SSOT } from '../../shared/dingtalk-prompts';
import { DINGTALK_ORAL_SEND_GUARD as VENDORED_GUARD } from '../../sto-plugin/openclaw/sto-dingtalk-send-guard/shared/dingtalk-prompts/dingtalk-oral-send-prompt';

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

describe('DINGTALK_ORAL_SEND_GUARD', () => {
  it('requires search-tool id resolution and blocks prompt id reuse', () => {
    expect(DINGTALK_ORAL_SEND_GUARD).toContain('id 必经搜人工具');
    expect(DINGTALK_ORAL_SEND_GUARD).toContain('禁止使用 prompt 别处');
    expect(DINGTALK_ORAL_SEND_GUARD).toContain('重名拒发');
    expect(DINGTALK_ORAL_SEND_GUARD).toContain('发送前回显');
    expect(DINGTALK_ORAL_SEND_GUARD).toContain('share_to_dingtalk');
  });

  it('keeps deprecated prompt alias equal to guard SSOT', () => {
    expect(DINGTALK_ORAL_SEND_PROMPT).toBe(DINGTALK_ORAL_SEND_GUARD);
    expect(DINGTALK_ORAL_SEND_GUARD).toBe(GUARD_SSOT);
    expect(VENDORED_GUARD).toBe(GUARD_SSOT);
  });
});
