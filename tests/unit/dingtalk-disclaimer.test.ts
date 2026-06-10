import { describe, expect, it } from 'vitest';
import {
  appendDingTalkAgentSendDisclaimer,
  DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER,
  ensureDingTalkAgentSendDisclaimerFormat,
  hasDingTalkDisclaimerDivider,
} from '../../shared/dingtalk-disclaimer';
import {
  fixDwsChatMessageSendArgv,
  fixDwsChatMessageSendShellScript,
  normalizeDwsChatMessageSendText,
} from '../../shared/dws-send-text';

describe('ensureDingTalkAgentSendDisclaimerFormat', () => {
  it('appends divider and footer when missing', () => {
    const result = appendDingTalkAgentSendDisclaimer('正文内容');
    expect(result).toContain('正文内容');
    expect(result).toContain('---');
    expect(result).toContain(DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER);
    expect(hasDingTalkDisclaimerDivider(result)).toBe(true);
  });

  it('inserts divider when footer exists without --- (scheduled task case)', () => {
    const bodyOnlyFooter = `### 任务结果\n\n- 条目一\n\n${DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER}`;
    const result = ensureDingTalkAgentSendDisclaimerFormat(bodyOnlyFooter);
    expect(result).toMatch(/条目一\n\n---\n\n<font color='#999999'>/);
    expect(hasDingTalkDisclaimerDivider(result)).toBe(true);
  });

  it('keeps existing divider + footer unchanged', () => {
    const complete = appendDingTalkAgentSendDisclaimer('已有格式');
    expect(ensureDingTalkAgentSendDisclaimerFormat(complete)).toBe(complete);
  });
});

describe('normalizeDwsChatMessageSendText', () => {
  it('fixes shell script missing disclaimer divider', () => {
    const body = `报告正文\n\n${DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER}`;
    const script = `dws chat message send --user uid-1 --title "消息" --text "${body.replace(/\n/g, '\\n')}" --format json`;
    const fixed = fixDwsChatMessageSendShellScript(script);
    expect(fixed).toContain("---");
    expect(fixed).toMatch(/\$'[\s\S]*---[\s\S]*STO Claw 代为发送/);
  });

  it('dedupes broken footer and keeps single disclaimer line', () => {
    const broken = [
      '请查看图片：https://example.com',
      '',
      '---',
      '',
      '本消息由 STO Claw 代为发送，非本人实时回复。',
      '',
      '<font color=',
      "#999999>本消息由 STO Claw 代为发送，非本人实时回复。",
    ].join('\n');
    const result = ensureDingTalkAgentSendDisclaimerFormat(broken);
    expect(result).toBe(
      `请查看图片：https://example.com\n\n---\n\n${DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER}`,
    );
    expect((result.match(/STO Claw 代为发送/g) || []).length).toBe(1);
  });

  it('fixes double-quoted shell --text with embedded HTML quotes', () => {
    const body = `请查收图片\n\n---\n\n<font color="#999999">本消息由 STO Claw 代为发送，非本人实时回复。</font>`;
    const script =
      `dws chat message send --user uid-1 --title "消息" --text "${body.replace(/\n/g, '\\n')}" --format json`;
    const fixed = fixDwsChatMessageSendShellScript(script);
    expect(fixed).toContain("$'");
    expect(fixed).not.toContain('color="#999999"');
    expect(fixed).toMatch(/---[\s\S]*STO Claw 代为发送/);
  });

  it('fixes argv missing disclaimer divider', () => {
    const body = `报告正文\n\n${DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER}`;
    const args = fixDwsChatMessageSendArgv([
      'chat',
      'message',
      'send',
      '--user',
      'uid-1',
      '--title',
      '消息',
      '--text',
      body,
      '--format',
      'json',
    ]);
    const text = args[args.indexOf('--text') + 1];
    expect(typeof text).toBe('string');
    expect(hasDingTalkDisclaimerDivider(text as string)).toBe(true);
  });

  it('unwraps bash $ quote and literal newlines in argv --text', () => {
    const raw = "$'### 标题\\n\\n| 指标 | 数值 |\\n| --- | --- |'";
    const args = fixDwsChatMessageSendArgv([
      'chat',
      'message',
      'send',
      '--text',
      raw,
      '--format',
      'json',
    ]);
    const text = args[args.indexOf('--text') + 1] as string;
    expect(text.startsWith('$')).toBe(false);
    expect(text).toContain('### 标题');
    expect(text).toContain('| 指标 | 数值 |');
    expect(text).not.toContain('\\n');
    expect(hasDingTalkDisclaimerDivider(text)).toBe(true);
  });

  it('unwraps bash $ quote in shell script --text', () => {
    const script =
      "dws chat message send --user uid-1 --title \"消息\" --text $'### 标题\\n\\n正文' --format json";
    const fixed = fixDwsChatMessageSendShellScript(script);
    expect(fixed).toContain("$'");
    expect(fixed).not.toMatch(/\$'### 标题\\n\\n正文'/);
    expect(fixed).toMatch(/\$'[\s\S]*### 标题[\s\S]*正文/);
  });
});
